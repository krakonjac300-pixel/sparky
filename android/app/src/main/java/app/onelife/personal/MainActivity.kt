package app.onelife.daybook

import android.Manifest
import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.ContentUris
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.CalendarContract
import android.provider.Settings
import android.speech.RecognizerIntent
import android.util.Base64
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsCompat
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.Lifecycle
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.Duration
import java.io.File

private const val APP_HOST = "appassets.androidplatform.net"
private const val ORIGIN = "https://appassets.androidplatform.net"
private const val IMAGE_LIMIT = 8 * 1024 * 1024
private typealias Reply = (Any?, String?) -> Unit

class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val chat by lazy { ChatGptPlan(this) }
    private val googleTasks = GoogleTasks()
    private var sharedText = ""
    private var pending: Reply? = null
    private var backupSource: java.io.InputStream? = null
    private var upload: BackupUpload? = null
    private val backupReader = BackupReader()
    private var progressImage: ByteArray? = null
    private var reminderTime: String? = null
    private var notificationsOnly = false
    private var remindersSynced = false
    private var appView: WebView? = null
    private var pendingHabitOpen: JSONObject? = null
    private var previousUsageAccess: Boolean? = null
    private var requestingBackgroundHealth = false
    private val healthPermission = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
        val reply = takeReply() ?: return@registerForActivityResult
        if (requestingBackgroundHealth) {
            reply(PhoneActivityData.backgroundPermission in granted, null)
        } else runWork(reply) {
            val permissions = PhoneActivityData.healthClient(this)?.permissionController?.getGrantedPermissions() ?: granted
            check(PhoneActivityData.healthPermissions.any(permissions::contains)) {
                "Allow a health metric in Health Connect to start syncing."
            }
            PhoneActivityData.configure(this, "health", true)
            true
        }
    }
    private val plannerCalendarPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        takeReply()?.invoke(granted, null)
    }
    private val calendarPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val reply = takeReply() ?: return@registerForActivityResult
        if (granted) readCalendar(reply) else reply(null, "Calendar permission was declined.")
    }
    private val usagePermission = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        val reply = takeReply() ?: return@registerForActivityResult
        runWork(reply) {
            val granted = PhoneActivityData.hasUsageAccess(this)
            if (granted) PhoneActivityData.configure(this, "usage", true)
            granted
        }
    }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val reply = takeReply() ?: return@registerForActivityResult
        if (notificationsOnly) reply(granted && canNotify(this), null)
        else if (granted) {
            scheduleReminder(this, reminderTime)
            reply(true, null)
        } else reply(null, "Notification permission was declined.")
        reminderTime = null
        notificationsOnly = false
    }
    private val googleTaskConsent = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        val reply = takeReply() ?: return@registerForActivityResult
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) {
            reply(null, "Google Tasks authorization was cancelled.")
        } else {
            try {
                readTaskLists(Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data), reply)
            } catch (error: ApiException) {
                reply(null, googleAuthorizationMessage(error))
            }
        }
    }
    private val voice = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull().orEmpty().take(2000)
        takeReply()?.invoke(text, null)
    }
    private val createBackup = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val reply = takeReply() ?: return@registerForActivityResult
        val content = backupSource
        backupSource = null
        if (uri == null || content == null) { content?.close(); reply(false, null) }
        else runWork(reply) {
            content.use {
                check(checkNotNull(contentResolver.openInputStream(uri)).use { file -> file.read() < 0 }) {
                    "Choose a new filename to keep the existing backup safe."
                }
                AutoBackup.writeVerified(this, uri, it)
            }
            true
        }
    }
    private val saveProgress = registerForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
        val image = progressImage
        progressImage = null
        val reply = takeReply() ?: return@registerForActivityResult
        if (uri == null || image == null) reply(false, null)
        else runWork(reply) {
            contentResolver.openOutputStream(uri, "wt")?.use { it.write(image) }
                ?: error("The image file could not be opened.")
            true
        }
    }
    private val openBackup = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val reply = takeReply() ?: return@registerForActivityResult
        if (uri == null) reply(false, null)
        else runWork(reply) {
            backupReader.open(checkNotNull(contentResolver.openInputStream(uri)))
            true
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!WeeklySummary.enabled(this)) WeeklySummary.disable(this)
        acceptSharedText(intent)
        readHabitIntent(intent)
        val assets = WebViewAssetLoader.Builder().addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        val web = WebView(this)
        appView = web
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url
                if (url.scheme != "https" || url.host != APP_HOST) {
                    return WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), null)
                }
                return assets.shouldInterceptRequest(url)?.apply {
                    if (url.path?.endsWith(".webp") == true) mimeType = "image/webp"
                }
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && uri.host == APP_HOST) return false
                if (request.isForMainFrame && uri.scheme == "https") runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                // "Report answer" in Coach opens the user's email app (Google Play AI-content policy).
                if (uri.scheme == "mailto") runCatching { startActivity(Intent(Intent.ACTION_SENDTO, uri)) }
                return true
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "OneLifeAndroid", setOf(ORIGIN)) { _, message, _, mainFrame, proxy ->
                if (!mainFrame) return@addWebMessageListener
                val request = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return@addWebMessageListener
                val id = request.optString("id")
                val reply: Reply = { value, error ->
                    val output = JSONObject().put("id", id).put("value", value ?: JSONObject.NULL)
                    if (error != null) output.put("error", error)
                    proxy.postMessage(output.toString())
                }
                runCatching { dispatch(request.optString("action"), request.optString("value"), reply) }
                    .onFailure { reply(null, it.message ?: "Android could not complete the request.") }
            }
        }
        val container = FrameLayout(this)
        container.addView(web, FrameLayout.LayoutParams(-1, -1))
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(container)
        web.loadUrl("$ORIGIN/index.html")
    }

    override fun onResume() {
        super.onResume()
        runCatching { FocusSilence.reconcile(this) }
        val granted = PhoneActivityData.hasUsageAccess(this)
        val changed = previousUsageAccess?.let { it != granted } == true
        previousUsageAccess = granted
        appView?.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('one-life-phone-activity', {detail:{usageChanged:$changed}}))",
            null
        )
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        acceptSharedText(intent)
        readHabitIntent(intent)
        if (pendingHabitOpen != null) {
            appView?.evaluateJavascript("window.dispatchEvent(new Event('one-life-phone-action'))", null)
        }
    }

    private fun readHabitIntent(intent: Intent) {
        if (intent.action == Intent.ACTION_VIEW && intent.dataString == "sparkyhabits://coach/return") {
            pendingHabitOpen = JSONObject().put("habitId", "").put("date", java.time.LocalDate.now().toString()).put("section", "coach")
        } else if (intent.action == OPEN_HABIT) {
            val habitId = intent.getStringExtra("habitId").orEmpty()
            val date = intent.getStringExtra("date").orEmpty()
            if (habitId.length in 1..100 && date.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) {
                pendingHabitOpen = JSONObject().put("habitId", habitId).put("date", date)
            }
        } else if (intent.action == OPEN_TODAY || intent.action == OPEN_BUDGET) {
            pendingHabitOpen = JSONObject().put("habitId", "").put("date", java.time.LocalDate.now().toString())
            if (intent.action == OPEN_BUDGET) pendingHabitOpen?.put("section", "budget")
        }
    }

    override fun onDestroy() {
        scope.cancel()
        backupReader.close()
        backupSource?.close()
        upload?.close()
        super.onDestroy()
    }

    private fun acceptSharedText(intent: Intent) {
        if (intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            sharedText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty().take(2000)
        }
    }

    private fun takeReply(): Reply? = pending.also { pending = null }

    private fun prompt(reply: Reply, launch: () -> Unit) {
        if (pending != null) {
            reply(null, "Finish the open Android prompt first.")
            return
        }
        pending = reply
        try { launch() } catch (error: Exception) {
            pending = null
            reply(null, error.message ?: "No compatible Android app is installed.")
        }
    }

    private fun dispatch(action: String, value: String, reply: Reply) {
        when (action) {
            "focusSilenceStart" -> {
                FocusSilence.start(this, value.toInt())?.let { Toast.makeText(this, it, Toast.LENGTH_LONG).show() }
                reply(true, null)
            }
            "focusSilenceEnd" -> { FocusSilence.end(this); reply(true, null) }
            "focusCue" -> {
                val cue = JSONObject(value)
                Feel.focusCue(this, cue.getString("phase"), cue.getBoolean("sound"), cue.getBoolean("vibration"))
                reply(true, null)
            }
            "focusSilenceSettings" -> { startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)); reply(true, null) }
            "chatStatus" -> runWork(reply) { chat.status() }
            "chatConnectionCheck" -> runWork(reply) { chat.checkConnection() }
            "chatConnectStage" -> reply(chatConnectStage, null)
            "chatConnect" -> {
                WeeklySummary.disable(this)
                runWork(reply) { chat.connect(value) { uri -> startActivity(Intent(Intent.ACTION_VIEW, uri)) } }
            }
            "chatSignOut" -> {
                WeeklySummary.disable(this)
                runWork(reply) { chat.signOut() }
            }
            "chatModels" -> runWork(reply) { chat.models() }
            "chatAsk" -> runWork(reply) { chat.ask(value) }
            "phoneActivity" -> {
                val foreground = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
                runWork(reply) { PhoneActivityData.refresh(this, foreground, force = value == "refresh") }
            }
            "connectHealth" -> requestHealth(reply, background = false, metric = value)
            "connectBackgroundHealth" -> requestHealth(reply, background = true)
            "installedUsageApps" -> runWork(reply) { installedUsageApps(this) }
            "connectUsage" -> {
                if (PhoneActivityData.hasUsageAccess(this)) {
                    runWork(reply) { PhoneActivityData.configure(this, "usage", true); true }
                } else prompt(reply) {
                    usagePermission.launch(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
                }
            }
            "pausePhoneActivity" -> runWork(reply) { PhoneActivityData.configure(this, value, false); true }
            "calendar" -> if (checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED) readCalendar(reply)
                else prompt(reply) { calendarPermission.launch(Manifest.permission.READ_CALENDAR) }
            "requestCalendarRead" -> if (checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED) reply(true, null)
                else prompt(reply) { plannerCalendarPermission.launch(Manifest.permission.READ_CALENDAR) }
            "calendarBusy" -> if (checkSelfPermission(Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED) reply(null, null)
                else runWork(reply) { busyIntervals(LocalDate.parse(value)) }
            "calendarBlockEditor" -> {
                val block = JSONObject(value)
                val start = block.getLong("start")
                val end = block.getLong("end")
                require(end > start)
                startActivity(Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
                    .putExtra(CalendarContract.Events.TITLE, block.getString("title").take(100))
                    .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
                    .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end))
                reply(true, null)
            }
            "calendarEvent" -> {
                startActivity(Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI).putExtra(CalendarContract.Events.TITLE, value.take(100)))
                reply(true, null)
            }
            "tasks" -> {
                val tasks = packageManager.getLaunchIntentForPackage("com.google.android.apps.tasks")
                startActivity(tasks ?: Intent(Intent.ACTION_VIEW, Uri.parse("https://tasks.google.com/")))
                reply(true, null)
            }
            "googleTaskConnect" -> connectGoogleTasks(reply)
            "googleTaskItems" -> runWork(reply) { googleTasks.tasks(value) }
            "googleTaskStatus" -> runWork(reply) { googleTasks.connected() }
            "googleTaskClear" -> runWork(reply) { googleTasks.clear(); true }
            "share" -> {
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, value.take(8000)), null))
                reply(true, null)
            }
            "shareProgressImage", "saveProgressImage" -> {
                require(value.length in 12..IMAGE_LIMIT) { "The image size is invalid." }
                val png = Base64.decode(value, Base64.NO_WRAP)
                require(png.take(8) == listOf(-119, 80, 78, 71, 13, 10, 26, 10).map(Int::toByte)) { "Expected a PNG image." }
                if (action == "saveProgressImage") prompt(reply) {
                    progressImage = png
                    saveProgress.launch("one-life-progress.png")
                } else {
                    val folder = File(cacheDir, "progress-share").apply { mkdirs() }
                    val cutoff = System.currentTimeMillis() - Duration.ofDays(1).toMillis()
                    folder.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
                    val file = File.createTempFile("one-life-progress-", ".png", folder).apply { writeBytes(png) }
                    val uri = FileProvider.getUriForFile(this, "$packageName.progress", file)
                    val intent = Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    intent.clipData = ClipData.newRawUri("Sparky progress", uri)
                    startActivity(Intent.createChooser(intent, null))
                    reply(true, null)
                }
            }
            "copy" -> {
                getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Sparky", value.take(8000)))
                reply(true, null)
            }
            "sharedText" -> { reply(sharedText, null); sharedText = "" }
            "voice" -> prompt(reply) {
                voice.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM))
            }
            "backupRead" -> runWork(reply) { backupReader.next() }
            "backupClose" -> { backupReader.close(); reply(true, null) }
            "backupBegin" -> { upload?.close(); upload = BackupUpload(cacheDir); reply(true, null) }
            "backupAppendBytes" -> {
                val destination = checkNotNull(upload)
                runWork(reply) { destination.append(value); true }
            }
            "backupAbort" -> {
                upload?.close()
                upload = null
                reply(true, null)
            }
            "backupFinish" -> {
                require(value in setOf("export", "exportChat", "autoBackup"))
                val content = checkNotNull(upload).finish()
                upload = null
                finishBackup(value, content, reply)
            }
            "export", "exportChat", "autoBackup" -> {
                require(value.length <= 16 * 1024)
                finishBackup(action, value.byteInputStream(), reply)
            }
            "import" -> prompt(reply) { openBackup.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) }
            "reminderStatus" -> reply(getSharedPreferences("one-life", MODE_PRIVATE).getString("reminder", "") ?: "", null)
            "syncHabitReminders" -> {
                syncHabitReminders(this, value, force = !remindersSynced)
                remindersSynced = true
                reply(true, null)
            }
            "requestNotifications" -> {
                if (canNotify(this)) reply(true, null)
                else if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    prompt(reply) { notificationsOnly = true; notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
                } else reply(false, null)
            }
            "syncBudgetPlan" -> runWork(reply) { BudgetSignals.syncPlan(this, value); true }
            "syncEvening" -> runWork(reply) { SparkyEvening.sync(this, value); true }
            "haptic" -> runWork(reply) { Feel.haptic(this, value); true }
            "keepAwake" -> {
                if (value == "on") window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                reply(true, null)
            }
            "soundAllowed" -> runWork(reply) { Feel.soundAllowed(this) }
            "weeklyStatus" -> reply(WeeklySummary.enabled(this), null)
            "weeklyGrant" -> reply(WeeklySummary.grant(this).orEmpty(), null)
            "weeklyEnable" -> {
                val choice = WeeklySummary.beginChoice()
                val owner = JSONObject(value).getString("owner")
                runWork(reply) {
                    check(chat.withAuthorizedOwner(owner) {
                        WeeklySummary.enable(this@MainActivity, value, choice, owner)
                    } != null) { "Connect this ChatGPT account before enabling weekly reviews." }
                    true
                }
            }
            "weeklyDisable" -> { WeeklySummary.disable(this); reply(false, null) }
            "syncWeekly" -> { WeeklySummary.sync(this, value); reply(true, null) }
            "weeklyResult" -> runWork(reply) { WeeklySummary.result(this, value) ?: "" }
            "clearWeekly" -> runWork(reply) { WeeklySummary.clearResult(this, value); true }
            "backupStatus" -> runWork(reply) { AutoBackup.status(this) }
            "backupEnabled" -> runWork(reply) { AutoBackup.setEnabled(this, value == "on") }
            "backupClear" -> runWork(reply) { AutoBackup.clear(this) }
            "openNotificationSettings" -> {
                val settings = Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName)
                startActivity(settings)
                reply(true, null)
            }
            "exactReminderStatus" -> reply(canScheduleExactReminder(this), null)
            "phoneHabitActions" -> {
                val result = JSONObject().put("completed", phoneCompletions(this)).put("open", pendingHabitOpen ?: JSONObject.NULL)
                pendingHabitOpen = null
                reply(result, null)
            }
            "ackPhoneHabitActions" -> { acknowledgeCompletions(this, value); reply(true, null) }
            "addHomeWidget" -> {
                val widgets = getSystemService(AppWidgetManager::class.java)
                check(widgets.isRequestPinAppWidgetSupported) { "Touch and hold a blank spot on your home screen, choose Widgets, and find Sparky." }
                val provider = when (value) {
                    "next" -> NextHabitWidget::class.java
                    "budget" -> AppBudgetWidget::class.java
                    "sparky" -> SparkyWidget::class.java
                    "count" -> HabitCountWidget::class.java
                    "streak" -> StreakWidget::class.java
                    "list" -> ChecklistWidget::class.java
                    else -> OneLifeWidget::class.java
                }
                reply(widgets.requestPinAppWidget(ComponentName(this, provider), null, null), null)
            }
            "openExactReminderSettings" -> {
                if (Build.VERSION.SDK_INT >= 31) startActivity(Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:$packageName")))
                reply(true, null)
            }
            "reminder" -> {
                require(value.isEmpty() || Regex("([01]\\d|2[0-3]):[0-5]\\d").matches(value)) { "Enter a valid reminder time." }
                val time = value.ifBlank { null }
                if (time != null && !canNotify(this) && Build.VERSION.SDK_INT >= 33) {
                    prompt(reply) { notificationsOnly = false; reminderTime = time; notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
                } else { scheduleReminder(this, time); reply(true, null) }
            }
            else -> reply(null, "This Android action is unavailable.")
        }
    }

    private fun connectGoogleTasks(reply: Reply) {
        val request = AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(TASKS_SCOPE))).build()
        Identity.getAuthorizationClient(this).authorize(request)
            .addOnSuccessListener { result ->
                if (isDestroyed) return@addOnSuccessListener
                val resolution = result.pendingIntent
                if (resolution != null) prompt(reply) {
                    googleTaskConsent.launch(IntentSenderRequest.Builder(resolution).build())
                } else readTaskLists(result, reply)
            }
            .addOnFailureListener { failure -> if (!isDestroyed) reply(null, googleAuthorizationMessage(failure)) }
    }

    private fun readTaskLists(result: AuthorizationResult, reply: Reply) {
        val token = result.accessToken
        if (token.isNullOrBlank() || TASKS_SCOPE !in result.grantedScopes) {
            reply(null, "Google did not grant read access to Tasks.")
            return
        }
        runWork(reply) { googleTasks.authorize(token) }
    }

    private fun googleAuthorizationMessage(error: Throwable): String {
        val code = (error as? ApiException)?.statusCode
        return if (code == 10) "Google Tasks needs this app’s signing certificate registered in a Google Cloud OAuth client."
            else "Google Tasks authorization could not start${code?.let { " (Google Play Services code $it)" }.orEmpty()}."
    }

    private fun finishBackup(action: String, source: java.io.InputStream, reply: Reply) {
        if (action == "autoBackup") {
            runWork(reply) { source.use { AutoBackup.write(this, it, LocalDate.now()) } }
        } else {
            prompt({ result, error ->
                if (error != null) source.close()
                reply(result, error)
            }) {
                createBackup.launch(if (action == "exportChat") "one-life-chat.json" else "one-life-backup.json")
                backupSource = source
            }
        }
    }

    private fun runWork(reply: Reply, block: suspend () -> Any) {
        scope.launch {
            try { reply(withContext(Dispatchers.IO) { block() }, null) }
            catch (error: Exception) { reply(null, error.message ?: "Could not complete the Android request.") }
        }
    }

    private fun requestHealth(reply: Reply, background: Boolean, metric: String = "") {
        scope.launch {
            try {
                val client = PhoneActivityData.healthClient(this@MainActivity)
                    ?: error("Install or update Health Connect on this phone first.")
                val granted = client.permissionController.getGrantedPermissions()
                val permissions = if (background) {
                    check(PhoneActivityData.supportsBackground(client)) { "This phone syncs health data when Sparky is open." }
                    setOf(PhoneActivityData.backgroundPermission)
                } else if (metric.isEmpty()) setOf(PhoneActivityData.sleepPermission, PhoneActivityData.stepsPermission)
                else setOf(PhoneActivityData.permissionsByMetric.getValue(metric))
                val missing = permissions - granted
                if (missing.isEmpty()) {
                    if (!background) PhoneActivityData.configure(this@MainActivity, "health", true)
                    reply(true, null)
                } else prompt(reply) {
                    requestingBackgroundHealth = background
                    healthPermission.launch(missing)
                }
            } catch (error: Exception) {
                reply(null, error.message ?: "Could not open Health Connect permissions.")
            }
        }
    }

    private fun busyIntervals(day: LocalDate): JSONArray {
        val zone = ZoneId.systemDefault()
        val start = day.atStartOfDay(zone).toInstant().toEpochMilli()
        val end = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().also {
            // All-day instances use UTC calendar dates, including in other time zones.
            ContentUris.appendId(it, start - Duration.ofDays(1).toMillis())
            ContentUris.appendId(it, end + Duration.ofDays(1).toMillis())
        }.build()
        val visible = contentResolver.query(CalendarContract.Calendars.CONTENT_URI, arrayOf(CalendarContract.Calendars._ID),
            "${CalendarContract.Calendars.VISIBLE} = 1", null, null)?.use { it.moveToFirst() } ?: false
        check(visible) { "No visible calendar is available." }
        val fields = arrayOf(CalendarContract.Instances.BEGIN, CalendarContract.Instances.END, CalendarContract.Instances.ALL_DAY,
            CalendarContract.Events.AVAILABILITY, CalendarContract.Events.STATUS, CalendarContract.Events.SELF_ATTENDEE_STATUS)
        val busy = JSONArray()
        val cursor = contentResolver.query(uri, fields, "${CalendarContract.Calendars.VISIBLE} = 1", null, null)
            ?: error("Calendar could not be read.")
        cursor.use { rows ->
            while (rows.moveToNext()) {
                if (rows.getInt(3) == CalendarContract.Events.AVAILABILITY_FREE || rows.getInt(4) == CalendarContract.Events.STATUS_CANCELED ||
                    rows.getInt(5) == CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED) continue
                val allDay = rows.getInt(2) == 1
                fun time(column: Int): Long {
                    val value = rows.getLong(column)
                    return if (allDay) Instant.ofEpochMilli(value).atZone(ZoneOffset.UTC).toLocalDate()
                        .atStartOfDay(zone).toInstant().toEpochMilli() else value
                }
                val from = maxOf(start, time(0))
                val until = minOf(end, time(1))
                if (until > from) busy.put(JSONObject().put("start", from).put("end", until))
            }
        }
        return busy
    }

    private fun readCalendar(reply: Reply) = runWork(reply) {
        val now = System.currentTimeMillis()
        val end = now + Duration.ofDays(7).toMillis()
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().also {
            ContentUris.appendId(it, now)
            ContentUris.appendId(it, end)
        }.build()
        val fields = arrayOf(CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN, CalendarContract.Instances.ALL_DAY)
        val events = JSONArray()
        contentResolver.query(uri, fields, null, null, "${CalendarContract.Instances.BEGIN} ASC")?.use { rows ->
            while (events.length() < 30 && rows.moveToNext()) {
                events.put(JSONObject().put("title", (rows.getString(0) ?: "Calendar event").take(200))
                    .put("start", rows.getLong(1)).put("allDay", rows.getInt(2) == 1))
            }
        }
        events
    }

}
