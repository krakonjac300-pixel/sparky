package app.onelife.daybook

import android.app.AlarmManager
import android.app.AutomaticZenRule
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.service.notification.Condition
import android.service.notification.ConditionProviderService
import java.util.UUID

/** Ends a focus quiet period even when the WebView is suspended. */
class FocusSilence : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        runCatching { reconcile(context) }
    }

    companion object {
        private fun state(context: Context) = context.getSharedPreferences("focus-silence", Context.MODE_PRIVATE)
        private fun alarm(context: Context, request: Int) = PendingIntent.getBroadcast(context, request, Intent(context, FocusSilence::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

        private fun boot(context: Context) = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)

        private fun arm(context: Context, until: Long): Boolean {
            val manager = context.getSystemService(AlarmManager::class.java)
            return armExactWithBackup(canScheduleExactReminder(context),
                scheduleInexact = { manager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, until, alarm(context, 1)) },
                scheduleExact = { manager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, until, alarm(context, 0)) })
        }

        fun condition(context: Context, id: Uri): Condition {
            val prefs = state(context)
            val active = focusConditionActive(prefs.getString("condition", null), id.toString(),
                prefs.getInt("boot", -1), boot(context), prefs.getLong("until", 0L), SystemClock.elapsedRealtime())
            return Condition(id, "Sparky Focus", if (active) Condition.STATE_TRUE else Condition.STATE_FALSE)
        }

        fun reconcile(context: Context) {
            val prefs = state(context)
            if (!prefs.contains("until")) return
            val until = prefs.getLong("until", 0L)
            // Android 15 can also send BOOT_COMPLETED after a force stop on the same boot.
            if (prefs.contains("previous") ||
                focusNeedsRecovery(prefs.getInt("boot", -1), boot(context), until, SystemClock.elapsedRealtime())) {
                end(context)
            } else {
                // Force stop can discard both alarms. Relaunch before expiry reinstalls them.
                try { arm(context, until) } catch (_: Exception) { end(context) }
            }
        }

        fun start(context: Context, seconds: Int): String? {
            require(seconds in 1..86400)
            val notifications = context.getSystemService(NotificationManager::class.java)
            return try {
                end(context)
                if (!notifications.isNotificationPolicyAccessGranted) return "Focus timer started. Sparky has no Do Not Disturb access."
                check(!state(context).contains("until"))
                val currentBoot = boot(context)
                check(currentBoot >= 0)
                val until = SystemClock.elapsedRealtime() + seconds * 1000L
                val id = Uri.Builder().scheme("condition").authority(context.packageName)
                    .appendPath("focus").appendPath(UUID.randomUUID().toString()).build()
                // Save the identity before creating the rule so cleanup can find it even after a crash.
                check(state(context).edit().putString("condition", id.toString()).putLong("until", until)
                    .putInt("boot", currentBoot).commit())
                val exact = arm(context, until)
                val owner = ComponentName(context, FocusConditionProvider::class.java)
                val rule = AutomaticZenRule("Sparky Focus", owner, id, NotificationManager.INTERRUPTION_FILTER_ALARMS, true)
                val ruleId = checkNotNull(notifications.addAutomaticZenRule(rule))
                if (Build.VERSION.SDK_INT >= 29) notifications.setAutomaticZenRuleState(ruleId, condition(context, id))
                if (exact) null else "Focus timer started. Android may end quiet mode late without exact alarms."
            } catch (_: Exception) {
                runCatching { end(context) }
                "Focus timer started. Check Sparky Focus in Do Not Disturb settings."
            }
        }

        fun end(context: Context) {
            val prefs = state(context)
            if (!prefs.contains("until")) return
            val notifications = context.getSystemService(NotificationManager::class.java)
            // A failed stop must be retried on the next resume or policy access grant.
            check(prefs.edit().putLong("until", 0L).commit())
            if (!notifications.isNotificationPolicyAccessGranted) return
            val condition = prefs.getString("condition", null)
            if (condition != null) {
                val owner = ComponentName(context, FocusConditionProvider::class.java)
                val owned = notifications.automaticZenRules.filterValues { it.owner == owner && it.conditionId.toString() == condition }
                for (id in owned.keys) {
                    check(notifications.removeAutomaticZenRule(id) || notifications.getAutomaticZenRule(id) == null)
                }
            } else if (Build.VERSION.SDK_INT >= 35 && context.applicationInfo.targetSdkVersion >= 35) {
                // Migrate an older build's implicit rule.
                notifications.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
            } else if (notifications.currentInterruptionFilter == NotificationManager.INTERRUPTION_FILTER_ALARMS) {
                // Restore sessions started by older builds that changed the global filter.
                notifications.setInterruptionFilter(prefs.getInt("previous", NotificationManager.INTERRUPTION_FILTER_ALL))
            }
            check(prefs.edit().clear().commit())
            val manager = context.getSystemService(AlarmManager::class.java)
            manager.cancel(alarm(context, 0))
            manager.cancel(alarm(context, 1))
        }
    }
}

/** Android 9 uses subscriptions. Newer versions can also receive an immediate state update. */
class FocusConditionProvider : ConditionProviderService() {
    override fun onConnected() = Unit
    override fun onUnsubscribe(conditionId: Uri) = Unit
    override fun onSubscribe(conditionId: Uri) = notifyCondition(FocusSilence.condition(this, conditionId))
}

/** Arms the inexact backup first, then the exact alarm when allowed. Used by Focus recovery and every reminder. */
internal fun armExactWithBackup(canUseExact: Boolean, scheduleInexact: () -> Unit, scheduleExact: () -> Unit): Boolean {
    scheduleInexact()
    if (!canUseExact) return false
    return try {
        scheduleExact()
        true
    } catch (_: SecurityException) {
        false
    }
}

internal fun focusNeedsRecovery(savedBoot: Int, currentBoot: Int, until: Long, elapsed: Long) =
    savedBoot < 0 || currentBoot != savedBoot || elapsed >= until

internal fun focusConditionActive(savedId: String?, requestedId: String, savedBoot: Int, currentBoot: Int, until: Long, elapsed: Long) =
    savedId == requestedId && !focusNeedsRecovery(savedBoot, currentBoot, until, elapsed)
