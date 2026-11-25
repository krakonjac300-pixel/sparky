package app.onelife.daybook

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidReliabilityTest {
    private val belgrade = ZoneId.of("Europe/Belgrade")
    private val london = ZoneId.of("Europe/London")
    private val sunday = LocalDate.parse("2026-11-22")

    private fun rule(time: String, extra: String? = null) = ReminderRule(
        id = "daily", title = "Walk", days = (0..6).toSet(), since = LocalDate.parse("2020-01-01"),
        time = LocalTime.parse(time), avoid = false, accountedFor = emptySet(), checkbox = true,
        kind = "habit", message = null, committedDates = null, priorityDates = emptySet(), extraDates = emptySet(),
        extraTime = extra?.let(LocalTime::parse), notificationsDisabled = false, quietFrom = null, quietThrough = null)

    @Test fun focusArmsIndependentRecoveryBeforeRequestingAnExactAlarm() {
        val calls = mutableListOf<String>()
        assertTrue(armExactWithBackup(true, { calls.add("inexact") }, { calls.add("exact") }))
        assertEquals(listOf("inexact", "exact"), calls)
        calls.clear()
        assertFalse(armExactWithBackup(false, { calls.add("inexact") }, { error("Unexpected exact alarm") }))
        assertEquals(listOf("inexact"), calls)
    }

    @Test fun focusKeepsInexactRecoveryWhenExactPermissionChanges() {
        var recoveryArmed = false
        assertFalse(armExactWithBackup(true, { recoveryArmed = true }, { throw SecurityException() }))
        assertTrue(recoveryArmed)
    }

    @Test fun recoveryUsesElapsedTimeAndIdentifiesRestartsAndLegacyState() {
        assertFalse(focusNeedsRecovery(7, 7, 1000, 999))
        assertTrue(focusNeedsRecovery(7, 7, 1000, 1000))
        assertTrue(focusNeedsRecovery(7, 7, 1000, 1250))
        assertTrue(focusNeedsRecovery(7, 8, 1000, 2))
        assertTrue(focusNeedsRecovery(-1, 7, 1000, 2))
        assertTrue(focusNeedsRecovery(7, 7, 0, 7))
    }

    @Test fun providerCanOnlyActivateTheCurrentUnexpiredRuleOnItsOriginalBoot() {
        assertTrue(focusConditionActive("current", "current", 7, 7, 1000, 999))
        assertFalse(focusConditionActive("current", "old", 7, 7, 1000, 999))
        assertFalse(focusConditionActive(null, "old", 7, 7, 1000, 999))
        assertFalse(focusConditionActive("current", "current", 7, 7, 1000, 1000))
        assertFalse(focusConditionActive("current", "current", 7, 8, 1000, 2))
    }

    @Test fun springGapSelectsResolvedInstantsInOrder() {
        val day = LocalDate.parse("2026-03-29")
        val plan = listOf(rule("02:50", "03:10"))
        val start = day.atStartOfDay(belgrade)
        val first = day.atTime(3, 10).atZone(belgrade)
        val second = day.atTime(3, 50).atZone(belgrade)
        assertEquals(first.toInstant(), nextReminder(plan, start))
        assertEquals(second.toInstant(), nextReminder(plan, first))
        assertEquals(listOf(first.toInstant(), second.toInstant()),
            dueReminders(first.toInstant(), second) { plan }.map { it.instant })
    }

    @Test fun autumnOverlapUsesFirstOffsetOnly() {
        val day = LocalDate.parse("2026-10-25")
        val first = day.atTime(2, 30).atZone(belgrade).withEarlierOffsetAtOverlap()
        val repeated = first.withLaterOffsetAtOverlap()
        val plan = listOf(rule("02:30"))
        assertEquals(first.toInstant(), nextReminder(plan, day.atStartOfDay(belgrade)))
        assertEquals(day.plusDays(1).atTime(2, 30).atZone(belgrade).toInstant(), nextReminder(plan, first))
        assertTrue(dueReminders(repeated.toInstant(), repeated) { plan }.isEmpty())
    }

    @Test fun lateMidnightAlarmKeepsBothActionDatesAndCannotReplay() {
        val plan = listOf(rule("23:58", "00:03"))
        val expected = sunday.atTime(23, 58).atZone(belgrade).toInstant()
        val monday = sunday.plusDays(1)
        val now = monday.atTime(0, 5).atZone(belgrade)
        val due = dueReminders(expected, now) { plan }
        assertEquals(listOf(sunday, monday), due.map { it.date })
        val receipts = mutableSetOf<String>()
        assertEquals(due, claimReminders(due + due, receipts))
        assertTrue(claimReminders(due, receipts.toMutableSet()).isEmpty())
        assertEquals(monday.atTime(23, 58).atZone(belgrade).toInstant(), nextReminder(plan, now))
        assertEquals(listOf(monday), dueReminders(expected, now) { if (it == monday) plan else emptyList() }.map { it.date })
    }

    @Test fun exactAlarmAndItsBackupPostTheReminderOnce() {
        // Every reminder is armed twice (exact + inexact backup). Whichever copy arrives second, minutes later,
        // finds the slot already claimed and posts nothing. If exact access was revoked, the backup alone posts it.
        val plan = listOf(rule("15:00"))
        val expected = sunday.atTime(15, 0).atZone(belgrade).toInstant()
        val receipts = mutableSetOf<String>()
        val first = claimReminders(dueReminders(expected, sunday.atTime(15, 0).atZone(belgrade)) { plan }, receipts)
        assertEquals(1, first.size)
        val backupLater = dueReminders(expected, sunday.atTime(15, 9).atZone(belgrade)) { plan }
        assertTrue(claimReminders(backupLater, receipts).isEmpty())
        assertEquals(1, claimReminders(backupLater, mutableSetOf()).size)
    }

    @Test fun receiptsSeparateHabitReplacementAndDistinctSlots() {
        val habit = rule("20:00", "20:05")
        val replacement = habit.copy(kind = "replacement", extraTime = null)
        val end = sunday.atTime(20, 5).atZone(belgrade)
        val due = dueReminders(end.minusMinutes(5).toInstant(), end) { listOf(habit, replacement) }
        assertEquals(3, claimReminders(due, mutableSetOf()).size)
    }

    @Test fun lateDeliveryHonorsGraceAndQuietHoursAtSchedulingAndDelivery() {
        val now = sunday.atTime(20, 0).atZone(belgrade)
        val old = now.minusDays(2).toInstant()
        val plan = listOf(rule("18:59", "19:00"))
        assertEquals(listOf(LocalTime.of(19, 0)), dueReminders(old, now) { plan }.map { it.time })
        assertTrue(dueReminders(now.plusMinutes(1).toInstant(), now) { plan }.isEmpty())
        for ((from, through) in listOf("18:00" to "19:30", "19:30" to "02:00")) {
            val quiet = rule("19:00").copy(quietFrom = LocalTime.parse(from), quietThrough = LocalTime.parse(through))
            assertTrue(dueReminders(old, now) { listOf(quiet) }.isEmpty())
        }
    }

    @Test fun schedulerIncludesFutureExtraDatesOutsideWeeklyLookahead() {
        val date = sunday.plusDays(20)
        val once = rule("09:00").copy(days = emptySet(), extraDates = setOf(date))
        assertEquals(date.atTime(9, 0).atZone(belgrade).toInstant(), nextReminder(listOf(once), sunday.atStartOfDay(belgrade)))
    }

    @Test fun eveningAndSundayFollowLocalClockAfterTravelOrManualChange() {
        val before = Instant.parse("2026-11-22T18:00:00Z")
        for ((hour, weekday) in listOf(21 to null, 20 to DayOfWeek.SUNDAY)) {
            val original = nextSummary(before.atZone(belgrade), hour, null, weekday)
            val moved = nextSummary(before.atZone(london), hour, null, weekday)
            assertEquals(original.toInstant().plusSeconds(3600), moved.toInstant())
            assertEquals(sunday.atTime(hour, 0).atZone(london), moved)
            val nextDate = if (weekday == null) sunday.plusDays(1) else sunday.plusWeeks(1)
            val next = nextDate.atTime(hour, 0).atZone(london)
            assertEquals(next, nextSummary(moved.plusMinutes(1), hour, null, weekday))
            assertEquals(next, nextSummary(moved.minusHours(1), hour, sunday.toString(), weekday))
        }
    }

    @Test fun pendingCheckInSuppressesCachedVerdict() {
        assertEquals("Your check-in was saved. Open Sparky to update today's score.",
            SparkyEvening.message(null, sunday, pending = true).second)
        assertEquals("Sparky hasn't heard from you today", SparkyEvening.message(null, sunday, pending = false).first)
    }
}
