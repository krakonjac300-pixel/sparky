package app.onelife.daybook

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import org.json.JSONArray
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime

private const val CHANNEL = "daily-checkin"
private const val ALARM = "app.onelife.daybook.HABIT_REMINDER"
private const val EXPECTED = "deadline"
private const val RECEIPTS = "habit-reminder-receipts"

internal data class ReminderRule(val id: String, val title: String, val days: Set<Int>, val since: LocalDate,
    val time: LocalTime?, val avoid: Boolean, val accountedFor: Set<LocalDate>, val checkbox: Boolean,
    val kind: String, val message: String?, val committedDates: Set<LocalDate>?, val priorityDates: Set<LocalDate>, val extraDates: Set<LocalDate>,
    val extraTime: LocalTime?, val notificationsDisabled: Boolean, val quietFrom: LocalTime?, val quietThrough: LocalTime?) {
    fun due(date: LocalDate) = date >= since && (date in extraDates || (committedDates?.contains(date) ?: ((date.dayOfWeek.value % 7) in days)))
    fun tag() = "one-life.habit.$kind.$id"
    fun tag(date: LocalDate) = "${tag()}.$date"
    fun times() = listOfNotNull(time, extraTime).distinct()
    fun permits(time: LocalTime): Boolean {
        if (notificationsDisabled) return false
        val from = quietFrom ?: return true
        val through = quietThrough ?: return true
        return when {
            from < through -> time < from || time >= through
            from > through -> time < from && time >= through
            else -> true
        }
    }
}

internal fun habitPrefs(context: Context) = context.getSharedPreferences("one-life", Context.MODE_PRIVATE)

private fun dates(values: JSONArray): Set<LocalDate> =
    (0 until values.length()).map { LocalDate.parse(values.getString(it)) }.toSet()

private fun parsePlan(plan: JSONArray): List<ReminderRule> =
    (0 until plan.length()).map { index ->
        val item = plan.getJSONObject(index)
        val days = item.getJSONArray("days")
        fun time(key: String) = item.optString(key).takeIf { it.isNotBlank() }?.let(LocalTime::parse)
        ReminderRule(item.getString("id"), item.getString("title").take(80),
            (0 until days.length()).map(days::getInt).toSet(), LocalDate.parse(item.getString("since")),
            item.optString("time").takeIf { it.isNotBlank() }?.let { LocalTime.parse(it) }, item.getBoolean("avoid"),
            dates(item.getJSONArray("accountedFor")), item.optBoolean("checkbox"), item.optString("kind", "habit"),
            item.optString("message").takeIf { it.isNotBlank() }, item.optJSONArray("committedDates")?.let(::dates),
            dates(item.optJSONArray("priorityDates") ?: JSONArray()), dates(item.optJSONArray("extraDates") ?: JSONArray()),
            time("extraTime"), item.optBoolean("notificationsDisabled"), time("quietFrom"), time("quietThrough"))
    }

internal fun rules(context: Context) = runCatching {
    parsePlan(JSONArray(habitPrefs(context).getString("habit-reminders", "[]")))
}.getOrDefault(emptyList())

internal fun openRules(context: Context, plan: List<ReminderRule>, date: LocalDate): List<ReminderRule> {
    val queued = queuedHabitIds(context, date)
    return plan.filter { it.due(date) && date !in it.accountedFor && it.id !in queued }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) PhoneActivityData.ensureScheduled(context)
        val plan = rules(context)
        val now = ZonedDateTime.now()
        val parts = intent.data?.pathSegments
        if (parts?.size == 3) {
            val date = runCatching { LocalDate.parse(parts[2]) }.getOrNull() ?: return
            if (date < now.toLocalDate().minusDays(1) || date > now.toLocalDate()) return
            val rule = openRules(context, plan, date).firstOrNull { it.kind == parts[0] && it.id == parts[1] } ?: return
            val notifications = context.getSystemService(NotificationManager::class.java)
            when (intent.action) {
                "one-life.done" -> if (rule.checkbox && rule.kind == "habit") {
                    enqueueCompletion(context, rule.id, date)
                    cancelReminder(notifications, rule, date)
                    OneLifeWidget.refresh(context)
                    refreshSparkyWidgets(context)
                }
                "one-life.snooze" -> {
                    cancelReminder(notifications, rule, date)
                    val next = now.plusMinutes(30)
                    if (rule.permits(next.toLocalTime())) {
                        val trigger = broadcast(context, "one-life.snoozed", rule, date)
                        setHabitAlarm(context, next.toInstant().toEpochMilli(), trigger)
                    }
                }
                "one-life.snoozed" -> if (canNotify(context) && rule.permits(now.toLocalTime())) notify(context, rule, date)
            }
            return
        }
        scheduleNext(context, plan, now)
        if (intent.action == ALARM && intent.hasExtra(EXPECTED) && canNotify(context)) {
            val expected = Instant.ofEpochMilli(intent.getLongExtra(EXPECTED, 0L))
            val due = dueReminders(expected, now) { date -> openRules(context, plan, date) }
            if (due.isNotEmpty()) {
                val prefs = habitPrefs(context)
                val oldest = now.toLocalDate().minusDays(7).toString()
                val receipts = prefs.getStringSet(RECEIPTS, emptySet()).orEmpty()
                    .filterTo(mutableSetOf()) { it.substringBefore('|') >= oldest }
                val pending = claimReminders(due, receipts)
                // Persist before posting so a process restart cannot replay a delivered alert.
                if (pending.isNotEmpty() && prefs.edit().putStringSet(RECEIPTS, receipts).commit()) {
                    pending.forEach { notify(context, it.rule, it.date) }
                }
            }
        }
        OneLifeWidget.refresh(context)
        AppBudgetWidget.refresh(context)
    }

    private fun notify(context: Context, rule: ReminderRule, date: LocalDate) {
        val notifications = context.getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, "Habit reminders", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(context, 1, Intent(context, MainActivity::class.java)
            .setAction(OPEN_HABIT).setData(actionUri("open", rule, date)).putExtra("habitId", rule.id).putExtra("date", date.toString())
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val replacement = rule.kind == "replacement"
        val headline = if (replacement) "Your replacement plan" else if (rule.avoid) "Check in on your Break List" else "Still open: ${rule.title}"
        val content = if (replacement) rule.message ?: rule.title else if (rule.avoid) "Log your outcome for ${rule.title}" else rule.title
        val notification = Notification.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_today)
            .setContentTitle(headline).setContentText(content).setStyle(Notification.BigTextStyle().bigText(content))
            .setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(open).setAutoCancel(true).setGroup("sparky.habit-reminders")
            .addExtras(Bundle().apply { putString("one-life-date", date.toString()) })
        if (rule.checkbox && !replacement) notification.addAction(Notification.Action.Builder(null, "Done",
            broadcast(context, "one-life.done", rule, date)).build())
        notification.addAction(Notification.Action.Builder(null, "Snooze 30 min", broadcast(context, "one-life.snooze", rule, date)).build())
        notification.addAction(Notification.Action.Builder(null, if (rule.avoid) "Log outcome" else "Log progress", open).build())
        notifications.notify(rule.tag(date), 1, notification.build())
    }
}

private fun cancelReminder(manager: NotificationManager, rule: ReminderRule, date: LocalDate) {
    manager.cancel(rule.tag(date), 1)
    // Existing notifications from before date-specific tags still have working actions.
    if (manager.activeNotifications.any { it.tag == rule.tag() && it.notification.extras.getString("one-life-date") == date.toString() }) {
        manager.cancel(rule.tag(), 1)
    }
}

private fun actionUri(action: String, rule: ReminderRule, date: LocalDate): Uri =
    Uri.Builder().scheme("onelife").authority(action).appendPath(rule.kind).appendPath(rule.id).appendPath(date.toString()).build()

internal fun broadcast(context: Context, action: String, rule: ReminderRule, date: LocalDate): PendingIntent =
    PendingIntent.getBroadcast(context, 0, Intent(context, ReminderReceiver::class.java).setAction(action)
        .setData(actionUri(action, rule, date)), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

fun canNotify(context: Context): Boolean =
    (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
        context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

fun canScheduleExactReminder(context: Context): Boolean =
    Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

fun scheduleReminder(context: Context, time: String?) {
    habitPrefs(context).edit().putString("reminder", time).apply()
}

fun syncHabitReminders(context: Context, json: String, force: Boolean) {
    require(json.length <= 2_000_000) { "The reminder plan is too large." }
    val plan = parsePlan(JSONArray(json))
    val previous = rules(context)
    check(habitPrefs(context).edit().putString("habit-reminders", json).commit()) { "Could not save the Android reminder plan." }
    val sameSchedule = previous.map { it.copy(accountedFor = emptySet(), priorityDates = emptySet()) } ==
        plan.map { it.copy(accountedFor = emptySet(), priorityDates = emptySet()) }
    if (force || !sameSchedule || alarmIntent(context, 0, PendingIntent.FLAG_NO_CREATE) == null) {
        scheduleNext(context, plan, ZonedDateTime.now())
    }
    val today = LocalDate.now()
    val yesterday = today.minusDays(1)
    val enabled = plan.filterNot { it.notificationsDisabled }
    val openTags = listOf(today, yesterday).associate { date ->
        date.toString() to openRules(context, enabled, date).flatMap { listOf(it.tag(), it.tag(date)) }.toSet()
    }
    val notifications = context.getSystemService(NotificationManager::class.java)
    notifications.activeNotifications.filter { entry -> entry.tag?.startsWith("one-life.habit.") == true &&
        entry.tag !in openTags[entry.notification.extras.getString("one-life-date")].orEmpty() }
        .forEach { notifications.cancel(it.tag, it.id) }
    OneLifeWidget.refresh(context)
}

private fun alarmIntent(context: Context, time: Long, flags: Int, code: Int = 2): PendingIntent? =
    PendingIntent.getBroadcast(context, code, Intent(context, ReminderReceiver::class.java).setAction(ALARM).putExtra(EXPECTED, time),
        PendingIntent.FLAG_IMMUTABLE or flags)

private fun scheduleNext(context: Context, rules: List<ReminderRule>, now: ZonedDateTime) {
    val alarm = context.getSystemService(AlarmManager::class.java)
    val next = nextReminder(rules, now)
    if (next == null) {
        for (code in listOf(2, 3)) alarmIntent(context, 0, PendingIntent.FLAG_NO_CREATE, code)?.let { alarm.cancel(it); it.cancel() }
    } else {
        val millis = next.toEpochMilli()
        val exact = alarmIntent(context, millis, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
        val backup = alarmIntent(context, millis, PendingIntent.FLAG_UPDATE_CURRENT, code = 3) ?: return
        // Receipts make the second copy a no-op, so the backup only matters when the exact alarm was cancelled.
        setReminderAlarm(context, millis, exact, backup)
    }
}

/**
 * Revoking "Alarms & reminders" makes Android cancel an app's exact alarms without telling it, so every scheduled
 * reminder also gets an inexact backup under its own PendingIntent. Receivers ignore whichever copy arrives second.
 */
internal fun setReminderAlarm(context: Context, millis: Long, exact: PendingIntent, backup: PendingIntent) {
    val alarm = context.getSystemService(AlarmManager::class.java)
    armExactWithBackup(canScheduleExactReminder(context),
        { alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, millis, backup) },
        { alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, millis, exact) })
}

private fun setHabitAlarm(context: Context, millis: Long, trigger: PendingIntent) {
    val alarm = context.getSystemService(AlarmManager::class.java)
    if (canScheduleExactReminder(context)) {
        try {
            alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, millis, trigger)
            return
        } catch (_: SecurityException) { /* The permission can change while scheduling. */ }
    }
    alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, millis, trigger)
}
