package app.onelife.daybook

import java.time.Duration
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.TemporalAdjusters

internal data class ReminderOccurrence(val rule: ReminderRule, val date: LocalDate, val time: LocalTime, val instant: Instant) {
    // Use the scheduled wall time so a clock change cannot replay the same slot.
    val receipt get() = "$date|${rule.kind.length}:${rule.kind}${rule.id}:$time"
}

private fun ReminderRule.occurrences(date: LocalDate, zone: ZoneId) = times().filter(::permits).map { time ->
    // Java shifts a gap forward and picks the earlier offset in an overlap.
    ReminderOccurrence(this, date, time, date.atTime(time).atZone(zone).toInstant())
}

internal fun nextReminder(plan: List<ReminderRule>, now: ZonedDateTime): Instant? {
    val today = now.toLocalDate()
    val after = now.toInstant()
    return plan.mapNotNull { rule ->
        val start = maxOf(today, rule.since)
        val regular = rule.committedDates?.asSequence() ?: (0L..7L).asSequence().map(start::plusDays)
        (regular + rule.extraDates.asSequence()).filter { it >= start && rule.due(it) }
            .flatMap { rule.occurrences(it, now.zone) }.map { it.instant }.filter { it > after }.minOrNull()
    }.minOrNull()
}

// Delayed alarms catch up for at most one hour, including the previous local date.
internal fun dueReminders(expected: Instant, now: ZonedDateTime, open: (LocalDate) -> List<ReminderRule>): List<ReminderOccurrence> {
    val end = now.toInstant()
    val start = maxOf(expected, end.minus(Duration.ofHours(1)))
    if (start > end) return emptyList()
    val lastDate = now.toLocalDate()
    return generateSequence(start.atZone(now.zone).toLocalDate()) { it.plusDays(1) }
        .takeWhile { it <= lastDate }
        .flatMap { date -> open(date).asSequence().filter { it.permits(now.toLocalTime()) }
            .flatMap { it.occurrences(date, now.zone) } }
        .filter { it.instant in start..end }.sortedBy { it.instant }.toList()
}

internal fun claimReminders(due: List<ReminderOccurrence>, receipts: MutableSet<String>) =
    due.filter { receipts.add(it.receipt) }

internal fun nextSummary(now: ZonedDateTime, hour: Int, posted: String?, weekday: DayOfWeek? = null): ZonedDateTime {
    val today = now.toLocalDate()
    val date = weekday?.let { today.with(TemporalAdjusters.nextOrSame(it)) } ?: today
    val candidate = date.atTime(hour, 0).atZone(now.zone)
    if (candidate.isAfter(now) && date.toString() != posted) return candidate
    val following = if (weekday == null) date.plusDays(1) else date.plusWeeks(1)
    return following.atTime(hour, 0).atZone(now.zone)
}
