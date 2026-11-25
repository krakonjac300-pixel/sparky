package app.onelife.daybook

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate
import java.time.LocalTime

/** Today's numbers from the summary the app sends on every change (see SparkyEvening.sync). */
private data class DayStatus(val done: Int, val total: Int, val frames: Int, val mood: String, val fresh: Boolean,
    val pending: Boolean = false)

private fun dayStatus(context: Context): DayStatus {
    if (scorePending(context, LocalDate.now())) {
        return DayStatus(0, 0, R.array.sparky_frames_ready, "Score pending", false, pending = true)
    }
    val summary = SparkyEvening.summary(context)
    if (summary?.optBoolean("streakPaused") == true) {
        val fresh = summary.optString("date") == LocalDate.now().toString()
        return DayStatus(summary.optInt("done"), summary.optInt("total"), R.array.sparky_frames_ready, "Scoring paused", fresh)
    }
    if (summary == null || summary.optString("date") != LocalDate.now().toString()) {
        return DayStatus(0, 0, R.array.sparky_frames_ready, "Open to check in", false)
    }
    val done = summary.optInt("done")
    val total = summary.optInt("total")
    // Older summaries have no "open"; then everything not done counts as open.
    val open = summary.optInt("open", total - done)
    val reviewTime = LocalTime.now().hour >= summary.optInt("hour", 21)
    val over = summary.optString("overLimit").isNotBlank() || freshOverLimit(context) != null
    // Before the evening check Sparky only reacts to wins and big overages, so mornings never start disappointed.
    val pose = when {
        reviewTime -> if (over) "disappointed" else summary.optString("pose")
        over -> "disappointed"
        summary.has("livePose") -> summary.optString("livePose")
        total > 0 && done >= total -> "proud"
        else -> "ready"
    }
    return when (pose) {
        "proud" -> DayStatus(done, total, R.array.sparky_frames_proud, "Proud of you", true)
        "so-so" -> DayStatus(done, total, R.array.sparky_frames_soso, "Almost there", true)
        "disappointed" -> DayStatus(done, total, R.array.sparky_frames_disappointed, if (over) "Over your limit" else "Not today", true)
        else -> DayStatus(done, total, R.array.sparky_frames_ready, when {
            total == 0 -> "Nothing due"
            open <= 0 -> "Done for today"
            else -> "$open to go"
        }, true)
    }
}

/** Frames cut from Sparky's original clips (android/widget_frames.py); the launcher flips them only while the widget is on screen. */
private fun animate(context: Context, views: RemoteViews, frames: Int) {
    val list = context.resources.obtainTypedArray(frames)
    try {
        views.removeAllViews(R.id.sparky_flipper)
        for (index in 0 until list.length()) {
            views.addView(R.id.sparky_flipper, RemoteViews(context.packageName, R.layout.sparky_frame).apply {
                setImageViewResource(R.id.sparky_frame, list.getResourceId(index, R.drawable.sparky_ready))
            })
        }
    } finally { list.recycle() }
}

/** Sparky, gently moving. At 1x1 only Sparky and the score show; wider adds his mood. */
class SparkyWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = refresh(context)
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) = refresh(context)

    companion object {
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, SparkyWidget::class.java))
            if (ids.isEmpty()) return
            val status = dayStatus(context)
            val score = status.fresh && status.total > 0
            for (id in ids) {
                val wide = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) >= 140
                val views = RemoteViews(context.packageName, R.layout.sparky_widget)
                animate(context, views, status.frames)
                views.setProgressBar(R.id.sparky_ring, maxOf(1, status.total), status.done, false)
                views.setViewVisibility(R.id.sparky_ring, if (score) View.VISIBLE else View.INVISIBLE)
                views.setTextViewText(R.id.sparky_score, if (score) "${status.done}/${status.total}" else "")
                views.setViewVisibility(R.id.sparky_score, if (score) View.VISIBLE else View.GONE)
                views.setTextViewText(R.id.sparky_mood, status.mood)
                views.setViewVisibility(R.id.sparky_mood, if (wide || status.pending) View.VISIBLE else View.GONE)
                views.setOnClickPendingIntent(R.id.widget_root, widgetLaunch(context, 8, OPEN_TODAY))
                manager.updateAppWidget(id, views)
            }
        }
    }
}

/** A tiny done/total counter with a progress bar. */
class HabitCountWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = refresh(context)

    companion object {
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, HabitCountWidget::class.java))
            if (ids.isEmpty()) return
            val status = dayStatus(context)
            val views = RemoteViews(context.packageName, R.layout.habit_count_widget)
            views.setTextViewText(R.id.count_value, if (status.fresh && status.total > 0) "${status.done}/${status.total}" else "-")
            views.setTextViewText(R.id.count_label, if (status.pending) "Score pending" else if (status.fresh) "habits" else "open app")
            views.setViewVisibility(R.id.count_progress, if (status.pending) View.INVISIBLE else View.VISIBLE)
            views.setProgressBar(R.id.count_progress, maxOf(1, status.total), status.done, false)
            views.setOnClickPendingIntent(R.id.widget_root, widgetLaunch(context, 9, OPEN_TODAY))
            manager.updateAppWidget(ids, views)
        }
    }
}

fun refreshSparkyWidgets(context: Context) {
    SparkyWidget.refresh(context)
    HabitCountWidget.refresh(context)
    StreakWidget.refresh(context)
    ChecklistWidget.refresh(context)
}
