package app.onelife.daybook

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.InputStream
import java.security.DigestInputStream
import java.security.MessageDigest
import java.time.LocalDate

private const val BACKUP_FOLDER = "Sparky"
private const val KEEP_BACKUPS = 30

internal object AutoBackup {
    private val fileName = Regex("""one-life-backup-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.json""")
    private const val ENABLED = "downloads-backup-enabled"
    private const val LAST = "downloads-backup-last"
    private val supported get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

    @Synchronized fun status(context: Context) = org.json.JSONObject()
        .put("supported", supported)
        .put("enabled", supported && habitPrefs(context).getBoolean(ENABLED, false))
        .put("last", habitPrefs(context).getLong(LAST, 0))
        .put("copies", if (supported) runCatching { snapshots(context).size }.getOrNull() else 0)

    @Synchronized fun setEnabled(context: Context, enabled: Boolean): org.json.JSONObject {
        check(!enabled || supported) { "Automatic copies need Android 10 or later." }
        check(habitPrefs(context).edit().putBoolean(ENABLED, enabled).commit())
        return status(context)
    }

    private val collection get() = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    private val folder get() = "${Environment.DIRECTORY_DOWNLOADS}/$BACKUP_FOLDER/"

    private fun snapshots(context: Context): List<Pair<android.net.Uri, String>> {
        val rows = mutableListOf<Pair<android.net.Uri, String>>()
        val fields = arrayOf(MediaStore.Downloads._ID, MediaStore.Downloads.DISPLAY_NAME)
        checkNotNull(context.contentResolver.query(collection, fields,
            "${MediaStore.Downloads.RELATIVE_PATH} = ? AND ${MediaStore.Downloads.OWNER_PACKAGE_NAME} = ?", arrayOf(folder, context.packageName), null)).use { cursor ->
            while (cursor.moveToNext()) {
                val match = fileName.matchEntire(cursor.getString(1)) ?: continue
                rows += android.content.ContentUris.withAppendedId(collection, cursor.getLong(0)) to match.groupValues[1]
            }
        }
        return rows
    }

    @Synchronized fun clear(context: Context): org.json.JSONObject {
        setEnabled(context, false)
        check(habitPrefs(context).edit().remove(LAST).commit())
        if (supported) {
            snapshots(context).forEach { (uri, _) -> runCatching { context.contentResolver.delete(uri, null, null) } }
            val remaining = snapshots(context).size
            check(remaining == 0) { "$remaining automatic backup files remain in Downloads/$BACKUP_FOLDER." }
        }
        return status(context)
    }

    @Synchronized fun write(context: Context, source: InputStream, date: LocalDate): org.json.JSONObject {
        check(supported && habitPrefs(context).getBoolean(ENABLED, false)) { "Automatic backups are off." }
        val resolver = context.contentResolver
        val existing = snapshots(context)
        val now = System.currentTimeMillis()
        val uri = checkNotNull(resolver.insert(collection, ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, "one-life-backup-$date-$now.json")
            put(MediaStore.Downloads.MIME_TYPE, "application/json")
            put(MediaStore.Downloads.RELATIVE_PATH, folder)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }))
        try {
            writeVerified(context, uri, source)
            check(resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null) == 1)
        } catch (error: Exception) {
            resolver.delete(uri, null, null)
            throw error
        }
        val keep = existing.filter { it.second != date.toString() }
            .sortedWith(compareByDescending<Pair<android.net.Uri, String>> { it.second }.thenByDescending { android.content.ContentUris.parseId(it.first) })
            .distinctBy { it.second }.take(KEEP_BACKUPS - 1).toSet()
        existing.filterNot { it in keep }.forEach { (old, _) -> check(resolver.delete(old, null, null) == 1) }
        check(habitPrefs(context).edit().putLong(LAST, now).commit())
        return status(context)
    }

    fun writeVerified(context: Context, uri: android.net.Uri, source: InputStream) {
        val resolver = context.contentResolver
        val expected = MessageDigest.getInstance("SHA-256")
        val size = DigestInputStream(backupStream(source), expected).use { input ->
            checkNotNull(resolver.openOutputStream(uri, "wt")).use { input.copyTo(it) }
        }
        check(size > 0) { "The backup was empty." }
        val actual = MessageDigest.getInstance("SHA-256")
        checkNotNull(resolver.openInputStream(uri)).use { input ->
            val buffer = ByteArray(8192)
            var offset = 0L
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                offset += read
                check(offset <= size) { "Backup verification failed." }
                actual.update(buffer, 0, read)
            }
            check(offset == size && expected.digest().contentEquals(actual.digest())) { "Backup verification failed." }
        }
    }
}
