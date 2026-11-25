package app.onelife.daybook

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PersistableBundle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZonedDateTime

private const val CHANNEL = "sparky-weekly"
private const val ACTION = "app.onelife.daybook.SPARKY_WEEKLY"
private const val PREFS_PROMPT = "weekly-prompt"
private const val PREFS_RESULT = "weekly-result"
private const val PREFS_POSTED = "weekly-posted"
private const val PREFS_ENABLED = "weekly-ai-enabled"
private const val GRANT = "weeklyGrant"
private const val JOB_ID = 4711
private const val HOUR = 20
/** A prompt older than this describes the wrong week, so Sparky asks to be opened instead. */
private const val FRESH_DAYS = 3L

/** Every Sunday evening Sparky asks ChatGPT for the week's review and sends it as a notification. */
object WeeklySummary {
    private val consent = WeeklyConsent()
    fun beginChoice() = consent.beginChoice()
    fun grant(context: Context): String? = habitPrefs(context).getString(GRANT, null)
    fun enabled(context: Context) = grant(context) != null

    fun <T> granted(context: Context, expected: String?, action: () -> T) =
        consent.granted(expected, { grant(context) }, action)

    private fun alarmIntent(context: Context, token: String?) =
        Intent(context, WeeklySummaryReceiver::class.java).setAction(ACTION).apply {
            if (token != null) data = Uri.fromParts("daybook-weekly", token, null)
        }

    fun disable(context: Context) = consent.invalidate {
        val previous = grant(context)
        check(habitPrefs(context).edit().remove(GRANT).remove(PREFS_ENABLED).remove(PREFS_PROMPT).remove(PREFS_POSTED).remove(PREFS_RESULT).commit())
        context.getSystemService(NotificationManager::class.java).cancel("one-life.sparky", 3)
        context.getSystemService(JobScheduler::class.java).cancel(JOB_ID)
        for (token in listOf(previous, null).distinct()) for (code in listOf(11, 13)) {
            val pending = PendingIntent.getBroadcast(context, code, alarmIntent(context, token),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_NO_CREATE)
            pending?.let { context.getSystemService(AlarmManager::class.java).cancel(it); it.cancel() }
        }
    }

    /** Stores the latest weekly prompt from the app (it has the data; Android only sends it on). */
    private fun prompt(json: String): JSONObject {
        require(json.length <= 70_000) { "The weekly summary request is too large." }
        val value = JSONObject(json)
        LocalDate.parse(value.getString("date"))
        require(value.getString("prompt").length in 1..4096)
        require(value.getString("owner").isNotBlank())
        require(value.getString("dataOwner").length <= 100)
        require(value.optString("model").matches(Regex("[A-Za-z0-9._:-]{0,160}")))
        return value
    }

    fun enable(context: Context, json: String, choice: Long, owner: String) {
        val value = prompt(json)
        require(value.getString("owner") == owner)
        consent.enable(choice, owner) { token ->
            check(habitPrefs(context).edit().putString(GRANT, token)
                .putString(PREFS_PROMPT, value.put(GRANT, token).toString())
                .remove(PREFS_POSTED).remove(PREFS_RESULT).commit())
            schedule(context)
        }
    }

    fun sync(context: Context, json: String) {
        val value = prompt(json)
        val token = value.optString(GRANT)
        granted(context, token) {
            val previous = JSONObject(habitPrefs(context).getString(PREFS_PROMPT, null) ?: return@granted)
            if (token.substringBefore('.') != value.getString("owner") || previous.optString(GRANT) != token ||
                previous.getString("dataOwner") != value.getString("dataOwner")) return@granted
            check(habitPrefs(context).edit().putString(PREFS_PROMPT, json).commit())
            schedule(context)
        }
    }

    fun schedule(context: Context) {
        val token = grant(context) ?: return
        val now = ZonedDateTime.now()
        val next = nextSummary(now, HOUR, habitPrefs(context).getString(PREFS_POSTED, null), DayOfWeek.SUNDAY)
        // Request code 11 is the exact alarm, 13 its inexact backup; the receiver starts the job once.
        val (exact, backup) = listOf(11, 13).map { code ->
            PendingIntent.getBroadcast(context, code, alarmIntent(context, token),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        setReminderAlarm(context, next.toInstant().toEpochMilli(), exact, backup)
    }

    /** The summary written in the background, until the app has saved it with its other summaries. */
    suspend fun result(context: Context, token: String): String? =
        ChatGptPlan(context).withAuthorizedOwner(token.substringBefore('.')) {
            granted(context, token) {
                habitPrefs(context).getString(PREFS_RESULT, null)?.takeIf { JSONObject(it).optString(GRANT) == token }
            }
        }

    fun clearResult(context: Context, receipt: String) {
        val ack = JSONObject(receipt)
        granted(context, ack.getString(GRANT)) {
            val prefs = habitPrefs(context)
            val stored = prefs.getString(PREFS_RESULT, null)?.let(::JSONObject)
            if (stored?.optString(GRANT) == ack.getString(GRANT) && stored.getString("date") == ack.getString("date")) {
                check(prefs.edit().remove(PREFS_RESULT).commit())
            }
        }
    }

    internal suspend fun write(context: Context, token: String) {
        val today = LocalDate.now()
        val prefs = habitPrefs(context)
        val stored = granted(context, token) {
            if (prefs.getString(PREFS_POSTED, "") == today.toString()) return@granted null
            prefs.getString(PREFS_PROMPT, null)?.let(::JSONObject)?.takeIf { it.optString(GRANT) == token }
        } ?: return
        val owner = stored.getString("owner")
        if (token.substringBefore('.') != owner) return
        val chat = ChatGptPlan(context)
        if (LocalDate.parse(stored.getString("date")).isBefore(today.minusDays(FRESH_DAYS))) {
            granted(context, token) {
                notify(context, "Sparky's weekly summary", "Open Sparky so Sparky can look at your week.")
                prefs.edit().putString(PREFS_POSTED, today.toString()).apply()
            }
            return
        }
        if (chat.withAuthorizedOwner(owner) { enabled(context) && grant(context) == token } != true) return
        val model = stored.optString("model").ifBlank { chat.models().getJSONObject(0).getString("id") }
        val request = JSONObject().put("model", model).put("owner", owner)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", stored.getString("prompt"))))
        val text = plain(chat.ask(request.toString()) { send ->
            check(granted(context, token, send) != null) { "Weekly review permission changed." }
        })
        chat.withAuthorizedOwner(owner) {
            granted(context, token) {
                if (prefs.getString(PREFS_POSTED, "") == today.toString()) return@granted
                check(text.isNotEmpty()) { "ChatGPT returned an empty summary." }
                val result = JSONObject().put(GRANT, token).put("dataOwner", stored.getString("dataOwner"))
                    .put("date", today.toString()).put("text", text.take(20_000))
                check(prefs.edit().putString(PREFS_RESULT, result.toString()).putString(PREFS_POSTED, today.toString()).commit())
                notify(context, "Sparky's weekly summary", text)
            }
        }
    }

    private fun notify(context: Context, title: String, text: String) {
        if (!canNotify(context)) return
        val notifications = context.getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, "Sparky's weekly summary", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(context, 12, Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        notifications.notify("one-life.sparky", 3, Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_today).setContentTitle(title).setContentText(text.take(200))
            .setStyle(Notification.BigTextStyle().bigText(text.take(5000))).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(open).setAutoCancel(true).build())
    }
}

/** Notifications cannot show formatting, so drop markdown marks and turn list dashes into bullets. */
internal fun plain(text: String) = text.lines().joinToString("\n") { line ->
    line.trim().replace(Regex("^#{1,6}\\s+"), "").replace(Regex("^[-*]\\s+"), "• ")
        .replace("**", "").replace("__", "").replace("`", "")
}.replace(Regex("\n{3,}"), "\n\n").trim()

/** The Sunday alarm hands the work to a job, which may wait for a network connection and run for minutes. */
class WeeklySummaryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!WeeklySummary.enabled(context)) return
        if (intent.action == ACTION) {
            val token = intent.data?.schemeSpecificPart ?: return
            val jobs = context.getSystemService(JobScheduler::class.java)
            // The backup alarm arrives too; rescheduling would restart a job that is already running.
            if (jobs.getPendingJob(JOB_ID) == null) WeeklySummary.granted(context, token) { jobs.schedule(
                JobInfo.Builder(JOB_ID, ComponentName(context, WeeklySummaryJob::class.java))
                    .setExtras(PersistableBundle().apply { putString(GRANT, token) })
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setBackoffCriteria(15 * 60 * 1000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                    .setOverrideDeadline(6 * 60 * 60 * 1000L)
                    .build()) }
        }
        WeeklySummary.schedule(context)
    }
}

class WeeklySummaryJob : JobService() {
    private var work: Job? = null

    override fun onStartJob(params: JobParameters): Boolean {
        val token = params.extras.getString(GRANT) ?: return false
        if (WeeklySummary.grant(this) != token) return false
        work = CoroutineScope(Dispatchers.Main).launch {
            try {
                WeeklySummary.write(applicationContext, token)
                jobFinished(params, false)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                jobFinished(params, WeeklySummary.grant(applicationContext) == token)
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        work?.cancel()
        work = null
        val token = params.extras.getString(GRANT) ?: return false
        return WeeklySummary.grant(this) == token
    }
}
