package app.onelife.daybook

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

private fun excludedUsageApps(packages: PackageManager): Set<String> =
    packages.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)
        .mapTo(mutableSetOf("android", "com.android.systemui")) { it.activityInfo.packageName }

internal fun installedUsageApps(context: Context): JSONArray {
    val packages = context.packageManager
    val excluded = excludedUsageApps(packages)
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    return JSONArray(packages.queryIntentActivities(launcher, 0)
        .map { it.activityInfo.applicationInfo }
        .filter { it.packageName !in excluded }
        .distinctBy { it.packageName }
        .map { app ->
            val name = packages.getApplicationLabel(app).toString().trim().take(120).ifEmpty { app.packageName }
            JSONObject().put("id", app.packageName).put("name", name)
        })
}

internal fun readScreenTime(context: Context, now: Instant, zone: ZoneId): List<JSONObject> {
    val today = now.atZone(zone).toLocalDate()
    val firstDay = today.minusDays(2)
    val begin = firstDay.minusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
    val end = now.toEpochMilli()
    val manager = context.getSystemService(UsageStatsManager::class.java)
    val events = checkNotNull(manager.queryEvents(begin, end)) { "Android usage history is temporarily unavailable." }
    val packages = context.packageManager
    val excluded = excludedUsageApps(packages)
    val names = mutableMapOf<String, String>()
    fun appName(packageName: String) = names.getOrPut(packageName) {
        runCatching { packages.getApplicationLabel(packages.getApplicationInfo(packageName, 0)).toString().trim() }
            .getOrNull()?.takeIf(String::isNotEmpty)?.take(120) ?: packageName
    }

    val totals = sortedMapOf<LocalDate, DayUsage>()
    val boundaries = (0L..3L).map { firstDay.plusDays(it).atStartOfDay(zone).toInstant().toEpochMilli() }
    val hourMillis = Duration.ofHours(1).toMillis()
    val startToday = boundaries[2]
    val active = mutableMapOf<String, MutableSet<String>>()
    var last = begin
    var interactive = true
    var locked = false

    fun countUntil(timestamp: Long) {
        if (timestamp <= last) return
        if (interactive && !locked && active.isNotEmpty()) {
            for (index in 0 until boundaries.lastIndex) {
                val elapsed = minOf(timestamp, boundaries[index + 1]) - maxOf(last, boundaries[index])
                if (elapsed <= 0) continue
                val day = totals.getOrPut(firstDay.plusDays(index.toLong())) { DayUsage() }
                day.millis += elapsed
                for (pkg in active.keys) day.apps[pkg] = (day.apps[pkg] ?: 0L) + elapsed
                if (index == 2) {
                    var cursor = maxOf(last, startToday)
                    val segmentEnd = minOf(timestamp, boundaries[3])
                    while (cursor < segmentEnd) {
                        val nextHour = startToday + ((cursor - startToday) / hourMillis + 1) * hourMillis
                        val until = minOf(segmentEnd, nextHour)
                        val hour = Instant.ofEpochMilli(cursor).atZone(zone).hour
                        day.hours[hour] = (day.hours[hour] ?: 0L) + until - cursor
                        cursor = until
                    }
                }
            }
        }
        last = timestamp
    }

    val event = UsageEvents.Event()
    while (events.getNextEvent(event)) {
        val timestamp = event.timeStamp
        if (timestamp !in last..end) continue
        countUntil(timestamp)
        val date = Instant.ofEpochMilli(timestamp).atZone(zone).toLocalDate()
        if (date in firstDay..today) totals.getOrPut(date) { DayUsage() }
        val pkg = event.packageName.orEmpty()
        val activity = event.className.orEmpty()
        when (event.eventType) {
            UsageEvents.Event.ACTIVITY_RESUMED -> if (pkg.isNotEmpty() && pkg !in excluded) {
                active.getOrPut(pkg) { mutableSetOf() }.add(activity)
            }
            UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> active[pkg]?.let { activities ->
                if (activity.isEmpty()) activities.clear() else activities.remove(activity)
                if (activities.isEmpty()) active.remove(pkg)
            }
            UsageEvents.Event.SCREEN_INTERACTIVE -> interactive = true
            UsageEvents.Event.SCREEN_NON_INTERACTIVE -> interactive = false
            UsageEvents.Event.KEYGUARD_SHOWN -> locked = true
            UsageEvents.Event.KEYGUARD_HIDDEN -> locked = false
            UsageEvents.Event.DEVICE_SHUTDOWN -> {
                active.clear()
                interactive = false
                locked = true
            }
            UsageEvents.Event.DEVICE_STARTUP -> {
                active.clear()
                interactive = true
                locked = false
            }
        }
    }
    countUntil(end)

    return totals.map { (date, day) ->
        val apps = day.apps.entries.sortedByDescending { it.value }.mapNotNull { (pkg, millis) ->
            val seconds = millis / 1000
            if (seconds == 0L) null else JSONObject().put("id", pkg).put("name", appName(pkg)).put("seconds", seconds)
        }
        JSONObject().put("date", date.toString()).put("seconds", day.millis / 1000).put("apps", JSONArray(apps)).apply {
            if (date == today) put("hours", JSONArray(day.hours.map { (hour, millis) ->
                JSONObject().put("hour", hour).put("value", millis / 1000)
            }))
        }
    }
}

private class DayUsage {
    var millis = 0L
    val apps = mutableMapOf<String, Long>()
    val hours = sortedMapOf<Int, Long>()
}
