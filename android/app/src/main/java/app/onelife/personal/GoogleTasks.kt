package app.onelife.daybook

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

const val TASKS_SCOPE = "https://www.googleapis.com/auth/tasks.readonly"
private val api = "https://tasks.googleapis.com/tasks/v1/".toHttpUrl()

class GoogleTasks {
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(12, TimeUnit.SECONDS).callTimeout(25, TimeUnit.SECONDS).build()
    private var credential: String? = null

    @Synchronized
    fun authorize(token: String): JSONArray {
        val url = api.newBuilder().addPathSegments("users/@me/lists").addQueryParameter("maxResults", "100").build()
        val lists = pages(url, token) { item ->
            JSONObject().put("id", item.getString("id")).put("title", item.optString("title", "Task list"))
        }
        credential = token
        return lists
    }

    @Synchronized
    fun tasks(list: String): JSONArray {
        require(list.isNotBlank() && list.length <= 200) { "Choose a Google Tasks list." }
        val token = credential ?: error("Connect Google Tasks again to read this list.")
        val url = api.newBuilder().addPathSegment("lists").addPathSegment(list).addPathSegment("tasks")
            .addQueryParameter("maxResults", "100").addQueryParameter("showCompleted", "false")
            .addQueryParameter("showHidden", "false").build()
        return pages(url, token) { item ->
            JSONObject().put("id", item.getString("id")).put("title", item.optString("title", "Task"))
                .put("due", item.optString("due").take(10))
        }
    }

    @Synchronized
    fun clear() { credential = null }

    @Synchronized
    fun connected() = credential != null

    private fun pages(url: okhttp3.HttpUrl, token: String, project: (JSONObject) -> JSONObject): JSONArray {
        val entries = JSONArray()
        forEachTaskPage(url) { next ->
            val page = get(next, token)
            val items = page.optJSONArray("items")
            if (items != null) for (index in 0 until items.length()) entries.put(project(items.getJSONObject(index)))
            page.optString("nextPageToken")
        }
        return entries
    }

    private fun get(url: okhttp3.HttpUrl, token: String): JSONObject {
        try {
            val request = Request.Builder().url(url).header("Accept", "application/json")
                .header("Authorization", "Bearer $token").build()
            return client.newCall(request).execute().use { response ->
                when (response.code) {
                    401 -> { credential = null; error("Google Tasks authorization expired. Connect again.") }
                    403 -> error("Google denied access. Check that the Tasks API is enabled for this Android app’s Google Cloud project.")
                }
                check(response.isSuccessful) { "Google Tasks returned HTTP ${response.code}." }
                JSONObject(response.body?.string().orEmpty())
            }
        } catch (_: IOException) { error("Sparky could not reach Google Tasks.") }
    }
}

internal fun forEachTaskPage(url: okhttp3.HttpUrl, readPage: (okhttp3.HttpUrl) -> String) {
    val seen = mutableSetOf<String>()
    var next = url
    while (true) {
        val cursor = readPage(next)
        if (cursor.isEmpty()) return
        check(seen.add(cursor)) { "Google Tasks repeated a page. Refresh to try again." }
        next = url.newBuilder().addQueryParameter("pageToken", cursor).build()
    }
}
