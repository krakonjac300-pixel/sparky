package app.onelife.daybook

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class SignInRetryTest {
    private fun blocked(cause: IOException) = OpenAiNetworkFailure("The OpenAI token exchange failed.", cause)

    @Test fun blockedLookupInTheBackgroundFinishesOnceSparkyIsOpenAgain() = runBlocking {
        // The first tries fail like Android's background network block (DNS), then the network is back.
        var attempts = 0
        val result = retryWhileOffline(timeoutMs = 5_000, pauseMs = 1) {
            attempts++
            if (attempts < 3) throw blocked(UnknownHostException("auth.openai.com")) else "connected"
        }
        assertEquals("connected", result)
        assertEquals(3, attempts)
    }

    @Test fun onlyFailuresThatNeverReachedOpenAiAreRetried() = runBlocking {
        assertTrue(blocked(UnknownHostException()).retrySafe)
        assertTrue(blocked(ConnectException()).retrySafe)
        // A timeout may mean OpenAI already used the one-time code, so it is reported instead of retried.
        assertFalse(blocked(SocketTimeoutException()).retrySafe)
        var attempts = 0
        try {
            retryWhileOffline(timeoutMs = 5_000, pauseMs = 1) { attempts++; throw blocked(SocketTimeoutException()) }
            fail("A timeout must not be retried")
        } catch (_: OpenAiNetworkFailure) { }
        assertEquals(1, attempts)
    }

    @Test fun retryingStopsAtTheDeadline() = runBlocking {
        var attempts = 0
        try {
            retryWhileOffline(timeoutMs = 30, pauseMs = 5) { attempts++; throw blocked(UnknownHostException()) }
            fail("Retrying must stop")
        } catch (failure: OpenAiNetworkFailure) {
            assertTrue(failure.message!!.contains("token exchange"))
        }
        assertTrue(attempts in 2..20)
    }
}
