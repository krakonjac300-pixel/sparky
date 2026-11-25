package app.onelife.daybook

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

internal const val OPEN_TODAY = "app.onelife.daybook.OPEN_TODAY"

internal fun widgetLaunch(context: Context, code: Int, action: String, habit: ReminderRule? = null, date: LocalDate? = null): PendingIntent {
    val intent = Intent(context, MainActivity::class.java).setAction(action)
        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (habit != null && date != null) intent.putExtra("habitId", habit.id).putExtra("date", date.toString())
    return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
}

class OneLifeWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        refresh(context)
    }

    companion object {
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, OneLifeWidget::class.java))
            val compact = manager.getAppWidgetIds(ComponentName(context, NextHabitWidget::class.java))
            ChecklistWidget.refresh(context)
            if (ids.isEmpty() && compact.isEmpty()) return
            val today = LocalDate.now()
            val plan = rules(context).filter { it.kind == "habit" }
            val open = openRules(context, plan, today).sortedWith(compareBy<ReminderRule> { today !in it.priorityDates }
                .thenBy { it.time == null }.thenBy { it.time })
            val next = open.firstOrNull()
            val views = RemoteViews(context.packageName, R.layout.one_life_widget)
            views.setTextViewText(R.id.widget_count, when (open.size) {
                0 -> if (plan.any { it.due(today) }) "All caught up" else "Nothing due today"
                1 -> "1 habit still open"
                else -> "${open.size} habits still open"
            })
            val time = next?.time?.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT))
            views.setTextViewText(R.id.widget_next, if (next == null) "Tap to open Today"
                else "Next · ${next.title}${time?.let { " · $it" }.orEmpty()}")
            views.setOnClickPendingIntent(R.id.widget_root, widgetLaunch(context, 5, OPEN_TODAY))
            if (ids.isNotEmpty()) manager.updateAppWidget(ids, views)
            if (compact.isNotEmpty()) {
                val nextHabit = open.firstOrNull { !it.avoid }
                val dueTime = nextHabit?.time?.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT))
                val label = if (dueTime == null) "Next habit" else "Next habit · $dueTime"
                val value = nextHabit?.title ?: if (plan.any { !it.avoid && it.due(today) }) "All caught up" else "Nothing due"
                val launch = widgetLaunch(context, 6, if (nextHabit == null) OPEN_TODAY else OPEN_HABIT, nextHabit, today)
                manager.updateAppWidget(compact, compactWidget(context, label, value, launch))
            }
        }
    }
}

class NextHabitWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = OneLifeWidget.refresh(context)
}

class AppBudgetWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = refresh(context)

    companion object {
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, AppBudgetWidget::class.java))
            if (ids.isEmpty()) return
            val budget = BudgetSignals.progress(context)
            val remaining = budget?.remaining
            val value = when {
                budget == null -> "Set a budget"
                remaining == null -> "Waiting for sync"
                remaining == 0L -> "At the limit"
                remaining < 0 -> "${budgetDuration(-remaining, compact = true)} over"
                else -> "${budgetDuration(remaining, compact = true)} left"
            }
            val views = compactWidget(context, budget?.name ?: "App budget", value, widgetLaunch(context, 7, OPEN_BUDGET))
            if (remaining != null && remaining < 0) views.setTextColor(R.id.widget_value, 0xFFFFC2BE.toInt())
            manager.updateAppWidget(ids, views)
        }
    }
}

private fun compactWidget(context: Context, label: String, value: String, launch: PendingIntent) =
    RemoteViews(context.packageName, R.layout.one_life_widget_compact).apply {
        setTextViewText(R.id.widget_label, label)
        setTextViewText(R.id.widget_value, value)
        setOnClickPendingIntent(R.id.widget_root, launch)
    }
