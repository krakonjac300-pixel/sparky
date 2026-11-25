package app.onelife.daybook

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.util.UUID

internal const val OPEN_HABIT = "app.onelife.daybook.OPEN_HABIT"
private const val QUEUE = "queued-habit-completions"

internal fun phoneCompletions(context: Context): JSONArray =
    runCatching { JSONArray(habitPrefs(context).getString(QUEUE, "[]")) }.getOrDefault(JSONArray())

internal fun queuedHabitIds(context: Context, date: LocalDate): Set<String> {
    val queue = phoneCompletions(context)
    return (0 until queue.length()).map(queue::getJSONObject)
        .filter { it.optString("date") == date.toString() }.map { it.getString("habitId") }.toSet()
}

internal fun scorePending(context: Context, date: LocalDate): Boolean =
    queuedHabitIds(context, date).isNotEmpty()

internal fun enqueueCompletion(context: Context, habitId: String, date: LocalDate) {
    val queue = phoneCompletions(context)
    queue.put(JSONObject().put("id", UUID.randomUUID().toString()).put("habitId", habitId).put("date", date.toString()).put("recordedAt", System.currentTimeMillis()))
    check(habitPrefs(context).edit().putString(QUEUE, queue.toString()).commit()) { "Could not save the notification action." }
    if (date == LocalDate.now()) postEvening(context, date, refreshOnly = true)
}

internal fun acknowledgeCompletions(context: Context, json: String) {
    // Older WebViews sent just the receipt IDs. Current ones include a committed score.
    val payload = if (json.trimStart().startsWith("{")) JSONObject(json) else null
    val ack = payload?.getJSONArray("ids") ?: JSONArray(json)
    val ids = (0 until ack.length()).map(ack::getString).toSet()
    val queue = phoneCompletions(context)
    val remaining = JSONArray()
    for (index in 0 until queue.length()) {
        val entry = queue.getJSONObject(index)
        if (entry.getString("id") !in ids) remaining.put(entry)
    }
    val changes = habitPrefs(context).edit().putString(QUEUE, remaining.toString())
    payload?.let { changes.putString(PREFS_SUMMARY, SparkyEvening.validatedSummary(it.getJSONObject("summary"))) }
    check(changes.commit()) { "Could not acknowledge the notification action." }
    SparkyEvening.schedule(context)
    postEvening(context, LocalDate.now(), refreshOnly = true)
    refreshSparkyWidgets(context)
}
