package app.onelife.daybook

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import org.json.JSONObject
import java.time.LocalDate

internal const val OPEN_BUDGET = "app.onelife.daybook.OPEN_BUDGET"

internal data class BudgetProgress(val name: String, val limit: Long, val used: Long?, val headsUp: Boolean) {
    val remaining = used?.let { limit - it }
}

/** Name of the watched budget when it is more than 10% over today, from the latest background screen time read. */
internal fun freshOverLimit(context: Context): String? {
    val budget = BudgetSignals.progress(context) ?: return null
    val used = budget.used ?: return null
    return if (budget.limit > 0 && used * 10 > budget.limit * 11) budget.name else null
}

internal object BudgetSignals {
    private const val channelId = "budget-heads-up"
    private const val notificationId = 4109

    private fun prefs(context: Context) = context.getSharedPreferences("one-life-budget", Context.MODE_PRIVATE)

    @Synchronized
    fun syncPlan(context: Context, value: String) {
        val store = prefs(context)
        if (value == "null") store.edit().remove("plan").apply()
        else {
            require(value.length <= 1024 * 1024) { "The app budget was too large." }
            val plan = JSONObject(value)
            require(plan.getString("name").isNotBlank() && plan.getLong("seconds") in 0L..86400L)
            LocalDate.parse(plan.getString("from"))
            require(plan.getJSONArray("apps").length() > 0)
            store.edit().putString("plan", plan.toString()).apply()
        }
        val screen = PhoneActivityData.lastScreen(context)
        if (screen != null) onUsage(context, screen) else AppBudgetWidget.refresh(context)
    }

    fun progress(context: Context, screen: JSONObject? = PhoneActivityData.lastScreen(context)): BudgetProgress? {
        val saved = prefs(context).getString("plan", null) ?: return null
        val plan = JSONObject(saved)
        val date = LocalDate.now().toString()
        if (plan.getString("from") > date) return null
        val selected = plan.getJSONArray("apps")
        val ids = (0 until selected.length()).mapTo(mutableSetOf(), selected::getString)
        val days = screen?.optJSONArray("days")
        var used: Long? = null
        for (index in 0 until (days?.length() ?: 0)) {
            val day = days!!.getJSONObject(index)
            if (day.getString("date") != date) continue
            val apps = day.getJSONArray("apps")
            used = (0 until apps.length()).sumOf { item ->
                val app = apps.getJSONObject(item)
                if (app.getString("id") in ids) app.getLong("seconds") else 0L
            }
            break
        }
        return BudgetProgress(plan.getString("name"), plan.getLong("seconds"), used, plan.optBoolean("headsUp"))
    }

    @Synchronized
    fun onUsage(context: Context, screen: JSONObject?) {
        AppBudgetWidget.refresh(context)
        refreshSparkyWidgets(context)
        if (screen == null) return
        val budget = progress(context, screen) ?: return
        val used = budget.used ?: return
        if (!budget.headsUp || used == 0L || used * 4 < budget.limit * 3 || !canNotify(context)) return
        val store = prefs(context)
        val date = LocalDate.now().toString()
        if (store.getString("last-heads-up", null) == date) return
        val notifications = context.getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(channelId, "App budget heads-up", NotificationManager.IMPORTANCE_DEFAULT))
        if (notifications.getNotificationChannel(channelId)?.importance == NotificationManager.IMPORTANCE_NONE) return
        val remaining = budget.limit - used
        val message = when {
            remaining < 0 -> "You’re ${budgetDuration(-remaining)} over today’s budget. Take a moment for your reset."
            remaining == 0L -> "You’ve used today’s full budget."
            else -> "About ${budgetDuration(remaining)} left in your app budget today."
        }
        notifications.notify(notificationId, Notification.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_menu_today).setContentTitle(budget.name.take(80)).setContentText(message)
            .setStyle(Notification.BigTextStyle().bigText(message)).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(widgetLaunch(context, notificationId, OPEN_BUDGET)).setAutoCancel(true).setOnlyAlertOnce(true).build())
        store.edit().putString("last-heads-up", date).apply()
    }
}

internal fun budgetDuration(seconds: Long, compact: Boolean = false): String {
    val minutes = seconds / 60
    if (minutes == 0L) return if (compact) "<1m" else "<1 min"
    val hours = minutes / 60
    val mins = minutes % 60
    return listOfNotNull(
        if (hours > 0) "${hours}${if (compact) "h" else " h"}" else null,
        if (mins > 0) "${mins}${if (compact) "m" else " min"}" else null
    ).joinToString(" ")
}
