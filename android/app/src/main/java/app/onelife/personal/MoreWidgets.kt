package app.onelife.daybook

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate
import java.time.LocalTime

/** Duolingo-style flame: the streak count, and Sparky worried in the evening when today still has to count. */
class StreakWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = refresh(context)

    companion object {
        private fun flameColor(days: Int) = Color.parseColor(when {
            days >= 100 -> "#C58CFF"
            days >= 30 -> "#6CC7FF"
            days >= 7 -> "#FFC94D"
            days >= 3 -> "#FF9A3D"
            days >= 1 -> "#FF7A45"
            else -> "#5E6B64"
        })

        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, StreakWidget::class.java))
            if (ids.isEmpty()) return
            val summary = SparkyEvening.summary(context)
            val today = LocalDate.now()
            val pending = scorePending(context, today) || scorePending(context, today.minusDays(1))
            val fresh = summary?.optString("date") == today.toString()
            val paused = summary?.optBoolean("streakPaused") == true
            val streak = if (fresh || paused) summary!!.optInt("streak") else 0
            val counted = fresh && summary!!.optBoolean("streakToday")
            val evening = LocalTime.now().hour >= 18
            val views = RemoteViews(context.packageName, R.layout.streak_widget)
            views.setInt(R.id.streak_flame, "setColorFilter", flameColor(streak))
            views.setTextViewText(R.id.streak_count, if (pending) "" else streak.toString())
            views.setTextViewText(R.id.streak_label, when {
                pending -> "Streak pending"
                paused -> "Streak paused"
                !fresh -> "Open Sparky"
                counted -> "day streak · today counts"
                streak == 0 -> "Start a streak today"
                evening -> "Keep it alive tonight!"
                else -> "day streak"
            })
            val worried = fresh && !paused && !counted && streak > 0 && evening
            views.setViewVisibility(R.id.streak_sparky, if (!pending && (worried || counted)) View.VISIBLE else View.GONE)
            views.setImageViewResource(R.id.streak_sparky, if (worried) R.drawable.sparky_disappointed else R.drawable.sparky_proud)
            views.setOnClickPendingIntent(R.id.widget_root, widgetLaunch(context, 10, OPEN_TODAY))
            manager.updateAppWidget(ids, views)
        }
    }
}

/** Today's open habits with one tap to finish: checkbox habits complete from the widget, others open in the app. */
class ChecklistWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = refresh(context)

    companion object {
        private val rows = listOf(
            Triple(R.id.list_row_0, R.id.list_title_0, R.id.list_hint_0), Triple(R.id.list_row_1, R.id.list_title_1, R.id.list_hint_1),
            Triple(R.id.list_row_2, R.id.list_title_2, R.id.list_hint_2), Triple(R.id.list_row_3, R.id.list_title_3, R.id.list_hint_3),
        )

        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, ChecklistWidget::class.java))
            if (ids.isEmpty()) return
            val today = LocalDate.now()
            val plan = rules(context).filter { it.kind == "habit" && !it.avoid }
            val open = openRules(context, plan, today).sortedWith(compareBy<ReminderRule> { today !in it.priorityDates }
                .thenBy { it.time == null }.thenBy { it.time })
            val summary = SparkyEvening.summary(context)?.takeIf { it.optString("date") == today.toString() }
            val pending = scorePending(context, today)
            val done = summary?.optInt("done") ?: 0
            val total = summary?.optInt("total") ?: 0
            val views = RemoteViews(context.packageName, R.layout.checklist_widget)
            views.setImageViewResource(R.id.list_sparky, when {
                !pending && open.isEmpty() && plan.any { it.due(today) } -> R.drawable.sparky_proud
                else -> R.drawable.sparky_ready
            })
            views.setTextViewText(R.id.list_heading, if (open.isEmpty()) "All done today" else "Today")
            views.setTextViewText(R.id.list_score, if (pending) "Score pending" else if (total > 0) "$done/$total" else "")
            views.setViewVisibility(R.id.list_score, if (pending || total > 0) View.VISIBLE else View.GONE)
            rows.forEachIndexed { index, (row, title, hint) ->
                val rule = open.getOrNull(index)
                views.setViewVisibility(row, if (rule == null) View.GONE else View.VISIBLE)
                if (rule != null) {
                    views.setTextViewText(title, rule.title)
                    views.setTextViewText(hint, if (rule.checkbox) "" else "Open")
                    views.setOnClickPendingIntent(row, if (rule.checkbox) broadcast(context, "one-life.done", rule, today)
                        else widgetLaunch(context, 20 + index, OPEN_HABIT, rule, today))
                }
            }
            views.setTextViewText(R.id.list_footer, when {
                pending && open.isEmpty() -> "Open Sparky to update your score."
                open.size > rows.size -> "+${open.size - rows.size} more in Sparky"
                open.isEmpty() -> if (plan.any { it.due(today) }) "Sparky is proud of you." else "Nothing due today."
                else -> "Tap a circle to finish it"
            })
            views.setOnClickPendingIntent(R.id.list_header, widgetLaunch(context, 11, OPEN_TODAY))
            views.setOnClickPendingIntent(R.id.widget_root, widgetLaunch(context, 12, OPEN_TODAY))
            manager.updateAppWidget(ids, views)
        }
    }
}
