package app.onelife.daybook

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class GoogleTaskPagesTest {
    @Test fun followsOpaqueTokensAndPreservesFilters() {
        for (path in listOf("users/@me/lists", "lists/my-list/tasks")) {
            val base = "https://tasks.googleapis.com/tasks/v1/$path?maxResults=100&showHidden=false".toHttpUrl()
            val tokens = listOf("page+/=?", "last page", "")
            val requests = mutableListOf<String?>()
            forEachTaskPage(base) { url ->
                assertEquals(base.encodedPath, url.encodedPath)
                assertEquals("100", url.queryParameter("maxResults"))
                assertEquals("false", url.queryParameter("showHidden"))
                requests.add(url.queryParameter("pageToken"))
                tokens[requests.lastIndex]
            }
            assertEquals(listOf(null, "page+/=?", "last page"), requests)
        }
    }

    @Test fun rejectsRepeatedToken() {
        var calls = 0
        assertThrows(IllegalStateException::class.java) {
            forEachTaskPage("https://example.invalid/".toHttpUrl()) {
                calls++
                check(calls < 3)
                "same"
            }
        }
        assertEquals(2, calls)
    }
}
