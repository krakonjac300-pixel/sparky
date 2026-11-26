package app.onelife.daybook

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZonedDateTime

private const val CHANNEL = "sparky-evening"
private const val ACTION = "app.onelife.daybook.SPARKY_EVENING"
internal const val PREFS_SUMMARY = "sparky-evening"
private const val PREFS_POSTED = "sparky-evening-posted"

/** Posts Sparky's verdict at the evening check time, even when Sparky is closed. */
object SparkyEvening {
    /** Stores today's summary from the app and makes sure the next evening alarm is set. */
    fun sync(context: Context, json: String) {
        require(json.length <= 20_000) { "The evening summary is too large." }
        val summary = JSONObject(json)
        val prefs = habitPrefs(context)
        check(prefs.edit().putString(PREFS_SUMMARY, validatedSummary(summary)).commit())
        schedule(context)
        postEvening(context, LocalDate.now(), refreshOnly = true)
        refreshSparkyWidgets(context)
    }

    internal fun validatedSummary(summary: JSONObject): String {
        val json = summary.toString()
        require(json.length <= 20_000) { "The evening summary is too large." }
        LocalDate.parse(summary.getString("date"))
        return json
    }

    fun schedule(context: Context) {
        val now = ZonedDateTime.now()
        val saved = summary(context)
        if (saved?.optBoolean("streakPaused") == true) return
        val hour = saved?.optInt("hour", 21)?.takeIf { it in 18..23 } ?: 21
        val next = nextSummary(now, hour, habitPrefs(context).getString(PREFS_POSTED, null))
        // Request code 7 is the exact alarm, 9 its inexact backup; postEvening posts once per day whichever arrives first.
        val (exact, backup) = listOf(7, 9).map { code ->
            PendingIntent.getBroadcast(context, code, Intent(context, SparkyEveningReceiver::class.java).setAction(ACTION),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        setReminderAlarm(context, next.toInstant().toEpochMilli(), exact, backup)
    }

    internal fun summary(context: Context): JSONObject? =
        runCatching { JSONObject(habitPrefs(context).getString(PREFS_SUMMARY, null) ?: return null) }.getOrNull()

    internal fun message(summary: JSONObject?, today: LocalDate, pending: Boolean): Pair<String, String> {
        if (pending) return "Sparky's evening check" to "Your check-in was saved. Open Sparky to update today's score."
        if (summary == null || summary.optString("date") != today.toString()) {
            return "Sparky hasn't heard from you today" to "Open Sparky and log what you did. He's waiting."
        }
        val done = summary.optInt("done")
        val total = summary.optInt("total")
        val missed = summary.optJSONArray("missed")?.let { list -> (0 until list.length()).map(list::getString) }.orEmpty()
        val overLimit = summary.optString("overLimit")
        val open = if (missed.isEmpty()) "" else " Still open: ${missed.joinToString(", ")}."
        val score = if (total > 0) "$done of $total habits done." else "No habits were due today."
        return when (summary.optString("pose")) {
            "proud" -> "Sparky is proud of you" to "$score Great day. Keep it going tomorrow."
            "so-so" -> "Sparky says: good, not great" to
                (if (overLimit.isNotBlank()) "$score Going over your $overLimit limit counts as one miss.$open" else "$score$open There's still time tonight.")
            "disappointed" -> "Sparky is disappointed" to
                (if (overLimit.isNotBlank()) "$score Going over your $overLimit limit counts as one miss.$open" else "$score$open One small step tonight still counts.")
            else -> "Sparky's evening check" to "$score$open"
        }
    }
}

@Synchronized
internal fun postEvening(context: Context, today: LocalDate, refreshOnly: Boolean) {
    val prefs = habitPrefs(context)
    val posted = prefs.getString(PREFS_POSTED, "") == today.toString()
    if (posted != refreshOnly || !canNotify(context)) return
    val manager = context.getSystemService(NotificationManager::class.java)
    val tag = "one-life.sparky"
    val notificationId = 2
    val previous = if (refreshOnly) {
        manager.activeNotifications.firstOrNull { it.tag == tag && it.id == notificationId }?.notification ?: return
    } else null
    val saved = SparkyEvening.summary(context)
    if (saved?.optBoolean("streakPaused") == true) {
        if (previous != null) manager.cancel(tag, notificationId)
        return
    }
    val summary = if (saved?.optString("date") == today.toString()) withFreshLimit(saved, freshOverLimit(context)) else saved
    val (title, text) = SparkyEvening.message(summary, today, scorePending(context, today))
    if (previous?.extras?.getCharSequence(Notification.EXTRA_TITLE) == title &&
        previous.extras.getCharSequence(Notification.EXTRA_TEXT) == text) return
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Sparky's evening check", NotificationManager.IMPORTANCE_DEFAULT))
    val open = PendingIntent.getActivity(context, 8, Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    manager.notify(tag, notificationId, Notification.Builder(context, CHANNEL)
        .setSmallIcon(android.R.drawable.ic_menu_today).setContentTitle(title).setContentText(text)
        .setStyle(Notification.BigTextStyle().bigText(text)).setVisibility(Notification.VISIBILITY_PRIVATE)
        .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(refreshOnly).build())
    if (!refreshOnly) prefs.edit().putString(PREFS_POSTED, today.toString()).apply()
}

class SparkyEveningReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION) postEvening(context, LocalDate.now(), refreshOnly = false)
        SparkyEvening.schedule(context)
        refreshSparkyWidgets(context)
    }
}
