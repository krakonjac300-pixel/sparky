package app.onelife.daybook

import android.app.AppOpsManager
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.os.Process
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateGroupByDurationRequest
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId

internal object PhoneActivityData {
    val sleepPermission = HealthPermission.getReadPermission(SleepSessionRecord::class)
    val stepsPermission = HealthPermission.getReadPermission(StepsRecord::class)
    val permissionsByMetric = mapOf("sleep" to sleepPermission, "steps" to stepsPermission,
        "exercise" to HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        "distance" to HealthPermission.getReadPermission(DistanceRecord::class))
    val healthPermissions = permissionsByMetric.values.toSet()
    const val backgroundPermission = HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
    private const val jobId = 4108
    // Android's shortest periodic job is 15 minutes; screen time is cheap to read, so it refreshes that often.
    private val syncInterval = Duration.ofMinutes(15).toMillis()
    private val healthInterval = Duration.ofHours(1).toMillis()
    private val screenFreshness = Duration.ofMinutes(10).toMillis()
    private val lock = Mutex()

    private fun store(context: Context) = context.getSharedPreferences("one-life-phone-activity", Context.MODE_PRIVATE)

    private fun usageEnabled(context: Context, prefs: SharedPreferences): Boolean =
        if (prefs.contains("usage")) prefs.getBoolean("usage", false) else hasUsageAccess(context)

    fun lastScreen(context: Context): JSONObject? {
        val prefs = store(context)
        if (!usageEnabled(context, prefs) || !hasUsageAccess(context)) return null
        return prefs.getString("screen", null)?.let(::JSONObject)
    }

    fun healthClient(context: Context): HealthConnectClient? =
        if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) HealthConnectClient.getOrCreate(context)
        else null

    fun supportsBackground(client: HealthConnectClient) = client.features.getFeatureStatus(
        HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND
    ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

    @Suppress("DEPRECATION")
    fun hasUsageAccess(context: Context): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java)
        val mode = if (Build.VERSION.SDK_INT >= 29) {
            ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        } else ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    suspend fun configure(context: Context, source: String, enabled: Boolean) = lock.withLock {
        require(source in setOf("health", "usage", "all"))
        val prefs = store(context)
        val edit = prefs.edit()
        if (source != "usage") {
            edit.putBoolean("health", enabled)
            if (!enabled) permissionsByMetric.keys.forEach(edit::remove)
        }
        if (source != "health") {
            edit.putBoolean("usage", enabled)
            if (!enabled) edit.remove("screen")
        }
        edit.apply()
        ensureScheduled(context)
        if (source != "health") AppBudgetWidget.refresh(context)
    }

    fun ensureScheduled(context: Context) {
        val prefs = store(context)
        val scheduler = context.getSystemService(JobScheduler::class.java)
        val existing = scheduler.getPendingJob(jobId)
        if (prefs.getBoolean("health", false) || usageEnabled(context, prefs)) {
            if (existing?.intervalMillis != syncInterval) {
                scheduler.schedule(JobInfo.Builder(jobId, ComponentName(context, PhoneActivityJob::class.java))
                    .setPeriodic(syncInterval).setPersisted(true).build())
            }
        } else if (existing != null) scheduler.cancel(jobId)
    }

    suspend fun refresh(context: Context, foreground: Boolean, force: Boolean = false): JSONObject = lock.withLock {
        if (foreground) ensureScheduled(context)
        val prefs = store(context)
        val now = Instant.now()
        val zone = ZoneId.systemDefault()
        val today = now.atZone(zone).toLocalDate()
        val from = today.minusDays(28)
        val output = JSONObject()
        val background = Duration.ofMinutes(5).toMillis()
        fun freshnessFor(key: String) = when {
            !foreground -> if (key == "screen") background else healthInterval - background
            key == "screen" -> screenFreshness
            else -> healthInterval
        }

        suspend fun load(key: String, read: suspend (JSONObject?) -> JSONObject): Boolean {
            val previous = prefs.getString(key, null)?.let { JSONObject(it) }
            val age = now.toEpochMilli() - (previous?.optLong("updated") ?: 0L)
            val current = try {
                if (!force && previous != null && age in 0 until freshnessFor(key) &&
                    previous.optString("day") == today.toString() && previous.optString("zone") == zone.id) previous
                else read(previous).put("updated", now.toEpochMilli()).put("day", today.toString()).put("zone", zone.id).also {
                    prefs.edit().putString(key, it.toString()).apply()
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                if (previous != null) output.put(key, previous)
                return false
            }
            output.put(key, current)
            return true
        }

        val healthEnabled = prefs.getBoolean("health", false)
        val health = JSONObject().put("state", "off")
        output.put("health", health)
        if (healthEnabled || foreground) {
            try {
                val client = healthClient(context)
                if (client == null) health.put("state", "unavailable")
                else {
                    val granted = client.permissionController.getGrantedPermissions()
                    val backgroundAvailable = supportsBackground(client)
                    val background = backgroundAvailable && backgroundPermission in granted
                    val sleep = sleepPermission in granted
                    val steps = stepsPermission in granted
                    val exercise = permissionsByMetric.getValue("exercise") in granted
                    val distance = permissionsByMetric.getValue("distance") in granted
                    health.put("sleep", sleep).put("steps", steps).put("exercise", exercise).put("distance", distance)
                        .put("backgroundAvailable", backgroundAvailable).put("background", background)
                    if (healthEnabled) {
                        health.put("state", if (healthPermissions.any(granted::contains)) "connected" else "permission")
                        if (foreground || background) {
                            val sleepOk = !sleep || load("sleep") {
                                healthPacket(from, today, readSleep(client, now, zone, from, today))
                            }
                            val stepsOk = !steps || load("steps") {
                                healthPacket(from, today, readSteps(client, now, zone, from))
                            }
                            val exerciseOk = !exercise || load("exercise") {
                                healthPacket(from, today, readMetric(client, now, zone, from, ExerciseSessionRecord.EXERCISE_DURATION_TOTAL) { it.toMinutes() })
                            }
                            val distanceOk = !distance || load("distance") {
                                healthPacket(from, today, readMetric(client, now, zone, from, DistanceRecord.DISTANCE_TOTAL) { it.inKilometers })
                            }
                            if (!sleepOk || !stepsOk || !exerciseOk || !distanceOk) health.put("state", "error")
                        }
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                health.put("state", "error")
            }
        }

        val usage = JSONObject().put("state", "off")
        output.put("usage", usage)
        if (usageEnabled(context, prefs)) {
            usage.put("state", when {
                !hasUsageAccess(context) -> "permission"
                load("screen") { previous ->
                    val days = previous?.optJSONArray("days") ?: JSONArray()
                    val merged = (0 until days.length()).map { days.getJSONObject(it) }
                        .filter { it.getString("date") >= from.toString() && it.getString("date") <= today.toString() }
                        .associateByTo(sortedMapOf()) { it.getString("date") }
                    for (entry in readScreenTime(context, now, zone)) merged[entry.getString("date")] = entry
                    JSONObject().put("days", JSONArray(merged.values))
                } -> "connected"
                else -> "error"
            })
            BudgetSignals.onUsage(context, output.optJSONObject("screen").takeIf { usage.optString("state") == "connected" })
        }
        output
    }

    private fun healthPacket(from: LocalDate, through: LocalDate, days: JSONArray) =
        JSONObject().put("from", from.toString()).put("through", through.toString()).put("days", days)

    private suspend fun <T : Any> readMetric(client: HealthConnectClient, now: Instant, zone: ZoneId, from: LocalDate,
        metric: AggregateMetric<T>, value: (T) -> Number): JSONArray {
        val results = client.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(
            metrics = setOf(metric), timeRangeFilter = TimeRangeFilter.between(from.atStartOfDay(), now.atZone(zone).toLocalDateTime()),
            timeRangeSlicer = Period.ofDays(1)))
        return JSONArray(results.mapNotNull { row -> row.result[metric]?.let {
            JSONObject().put("date", row.startTime.toLocalDate().toString()).put("value", value(it))
        } })
    }

    private suspend fun readSteps(client: HealthConnectClient, now: Instant, zone: ZoneId, from: LocalDate): JSONArray {
        val localNow = now.atZone(zone)
        val today = localNow.toLocalDate()
        val results = client.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(
            metrics = setOf(StepsRecord.COUNT_TOTAL),
            timeRangeFilter = TimeRangeFilter.between(from.atStartOfDay(), localNow.toLocalDateTime()),
            timeRangeSlicer = Period.ofDays(1)
        ))
        val days = results.mapNotNull { result ->
            result.result[StepsRecord.COUNT_TOTAL]?.let { count ->
                JSONObject().put("date", result.startTime.toLocalDate().toString()).put("steps", count)
            }
        }.associateByTo(sortedMapOf()) { it.getString("date") }
        val start = today.atStartOfDay(zone).toInstant()
        if (now > start) {
            val hours = readStepHours(client, start, now, zone)
            if (hours.isNotEmpty()) {
                days[today.toString()] = JSONObject().put("date", today.toString()).put("steps", hours.values.sum())
                    .put("hours", JSONArray(hours.map { (hour, steps) -> JSONObject().put("hour", hour).put("value", steps) }))
            }
        }
        return JSONArray(days.values)
    }

    private suspend fun readStepHours(client: HealthConnectClient, start: Instant, now: Instant, zone: ZoneId): Map<Int, Long> {
        val results = try {
            client.aggregateGroupByDuration(AggregateGroupByDurationRequest(
                metrics = setOf(StepsRecord.COUNT_TOTAL), timeRangeFilter = TimeRangeFilter.between(start, now),
                timeRangeSlicer = Duration.ofHours(1)
            ))
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // The daily totals are still available if the hourly query fails.
            return emptyMap()
        }
        val hours = sortedMapOf<Int, Long>()
        for (result in results) {
            val steps = result.result[StepsRecord.COUNT_TOTAL] ?: continue
            val hour = result.startTime.atZone(zone).hour
            hours[hour] = (hours[hour] ?: 0L) + steps
        }
        return hours
    }

    private suspend fun readSleep(client: HealthConnectClient, now: Instant, zone: ZoneId, from: LocalDate, through: LocalDate): JSONArray {
        val intervals = sortedMapOf<LocalDate, MutableList<Pair<Instant, Instant>>>()
        var page: String? = null
        do {
            val result = client.readRecords(ReadRecordsRequest(SleepSessionRecord::class,
                TimeRangeFilter.between(now.minus(Duration.ofDays(29)), now), pageToken = page))
            for (record in result.records) {
                val date = record.endTime.atZone(record.endZoneOffset ?: zone).toLocalDate()
                if (date in from..through && record.endTime <= now) {
                    intervals.getOrPut(date) { mutableListOf() }.add(record.startTime to record.endTime)
                }
            }
            page = result.pageToken
        } while (page != null)
        return JSONArray(intervals.mapNotNull { (date, spans) ->
            var total = Duration.ZERO
            var countedTo = Instant.MIN
            for ((start, end) in spans.sortedBy { it.first }) {
                if (end > countedTo) {
                    total = total.plus(Duration.between(maxOf(start, countedTo), end))
                    countedTo = end
                }
            }
            val minutes = total.toMinutes().coerceIn(0, 1440)
            if (minutes == 0L) null else JSONObject().put("date", date.toString())
                .put("minutes", minutes).put("source", "Health Connect")
        })
    }
}

class PhoneActivityJob : JobService() {
    private var work: Job? = null

    override fun onStartJob(params: JobParameters): Boolean {
        work = CoroutineScope(Dispatchers.Main).launch {
            try {
                withContext(Dispatchers.IO) { PhoneActivityData.refresh(applicationContext, foreground = false) }
                jobFinished(params, false)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                jobFinished(params, true)
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        work?.cancel()
        work = null
        return true
    }
}
