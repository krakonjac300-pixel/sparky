package app.onelife.daybook

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import java.io.BufferedReader
import java.io.InputStream
import java.math.BigInteger
import java.net.ConnectException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.net.URLEncoder
import java.security.KeyFactory
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.RSAPublicKeySpec
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.SSLException

private const val ISSUER = "https://auth.openai.com"
private const val ACCOUNTS = "$ISSUER/api/accounts"
private const val RESOURCE = "https://api.openai.com/v1"
private const val PLAN = "chatgpt.tokens.use.direct"
private const val CALLBACK = "/auth/callback"
private const val KEY_ALIAS = "one-life-chatgpt"
private const val BASE64_FLAGS = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
private val requiredScopes = setOf(PLAN, "resource.invoke")
private val random = SecureRandom()
// The weekly worker and the activity share the same encrypted account records.
private val sessionMutex = Mutex()
private fun owner(record: JSONObject) = encode(MessageDigest.getInstance("SHA-256")
    .digest(record.getString("subject").toByteArray(Charsets.UTF_8)))

class ChatGptPlan(context: Context) {
    private val prefs = context.getSharedPreferences("one-life-chatgpt", Context.MODE_PRIVATE)
    private data class Attempt(val redirect: String, val state: String, val nonce: String, val verifier: String)

    suspend fun <T> withAuthorizedOwner(expected: String, action: () -> T): T? = runExclusive {
        val record = session()
        if (record != null && record.has("access") && owner(record) == expected) action() else null
    }

    suspend fun status() = runExclusive {
        val session = session()
        val accounts = JSONArray()
        for (field in prefs.all.keys.filter { it.startsWith("account.") }.sorted()) {
            val record = readRecord(field) ?: continue
            accounts.put(JSONObject().put("id", record.getString("client")).put("email", record.optString("email")))
        }
        JSONObject()
            .put("authorized", session?.has("access") == true)
            .put("owner", session?.takeIf { it.has("access") }?.let(::owner).orEmpty())
            .put("registered", session != null || prefs.contains("pending-client"))
            .put("email", session?.optString("email").orEmpty())
            .put("accounts", accounts)
    }

    suspend fun connect(choice: String, openBrowser: (Uri) -> Unit) = runExclusive {
        try { connectSteps(choice, openBrowser) } finally { chatConnectStage = "" }
    }

    private suspend fun connectSteps(choice: String, openBrowser: (Uri) -> Unit): Boolean {
        val previous = when (choice) {
            "new" -> null
            "" -> session()
            else -> readRecord("account.$choice") ?: error("This saved ChatGPT account is unavailable.")
        }
        val knownClient = previous?.getString("client") ?: if (choice == "") prefs.getString("pending-client", null) else null
        val host = prefs.getString("host", null) ?: "urn:uuid:${UUID.randomUUID()}".also {
            check(prefs.edit().putString("host", it).commit()) { "Could not save this device’s ChatGPT identifier." }
        }
        val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
        server.use {
            val attempt = Attempt("http://127.0.0.1:${server.localPort}$CALLBACK", secret(), secret(), secret())
            val params = linkedMapOf(
                "client_id" to (knownClient ?: "dynamic_agent_client"), "ext_agent_host_id" to host,
                "response_type" to "code", "redirect_uri" to attempt.redirect, "resource" to RESOURCE,
                "scope" to "openid profile email offline_access resource.invoke $PLAN",
                "state" to attempt.state, "nonce" to attempt.nonce, "code_challenge_method" to "S256",
                "code_challenge" to encode(MessageDigest.getInstance("SHA-256").digest(attempt.verifier.toByteArray())),
            )
            if (knownClient == null) params["agent_name_hint"] = "Sparky"
            previous?.optString("idToken")?.takeIf { it.isNotEmpty() }?.let { params["id_token_hint"] = it }
            chatConnectStage = "browser"
            withContext(Dispatchers.Main) { openBrowser(Uri.parse("$ACCOUNTS/authorize?${form(params)}")) }
            val finish = { result: Uri ->
                chatConnectStage = "finishing"
                val returned = result.getQueryParameter("client_id")
                val client = knownClient ?: returned?.takeIf { it.startsWith("oaiapp_") && it.length <= 200 }
                    ?: error("OpenAI did not finish registering Sparky for plan usage.")
                check(returned == null || returned == client) { "The sign-in registration changed. Try again." }
                if (previous == null) {
                    check(prefs.edit().putString("pending-client", client).commit()) { "Could not save the pending OpenAI registration." }
                }
                val response = token(mapOf(
                    "grant_type" to "authorization_code", "client_id" to client,
                    "code" to result.getQueryParameter("code").orEmpty(), "code_verifier" to attempt.verifier,
                    "redirect_uri" to attempt.redirect, "resource" to RESOURCE,
                ))
                val claims = validateIdentity(response.getString("id_token"), client, attempt.nonce)
                val subject = claims.getString("sub")
                check(previous == null || subject == previous.getString("subject")) { "That is a different ChatGPT account. Use the option to connect another account." }
                val record = JSONObject().put("client", client).put("subject", subject).put("email", claims.optString("email"))
                try {
                    setTokens(record, response, mustGrant = true)
                } catch (failure: IllegalStateException) {
                    if (previous == null && session()?.has("access") != true) persist(record)
                    throw failure
                }
                record.put("idToken", response.getString("id_token"))
                persist(record)
                prefs.edit().remove("pending-client").apply()
            }
            // Android often blocks the network for an app in the background while the browser is in front.
            // The sign-in code is kept and the exchange finishes once Sparky is open again.
            receiveCallback(server, attempt.state, finish)?.let { pending ->
                chatConnectStage = "waiting"
                retryWhileOffline { finish(pending) }
            }
            return true
        }
    }

    suspend fun signOut() = runExclusive {
        val record = session() ?: return@runExclusive true
        val refresh = record.optString("refresh")
        val revoked = refresh.isEmpty() || runCatching {
            request("$ACCOUNTS/oauth/revoke", form(mapOf("token" to refresh, "token_type_hint" to "refresh_token",
                "client_id" to record.getString("client"))), formEncoded = true) { Unit }
        }.isSuccess
        clearTokens(record)
        persist(record)
        revoked
    }

    suspend fun checkConnection() = runExclusive {
        request("$ISSUER/.well-known/openid-configuration") {
            check(JSONObject(it.readSmall()).optString("issuer") == ISSUER) { "OpenAI returned unexpected sign-in configuration." }
        }
        try {
            request("$RESOURCE/models") { it.readSmall() }
        } catch (failure: OpenAiFailure) {
            if (failure.status != 401) throw failure
        }
        true
    }

    suspend fun models() = runExclusive {
        val catalog = request("$RESOURCE/models", bearer = access()) { JSONObject(it.readSmall()) }.getJSONArray("models")
        val result = JSONArray()
        for (index in 0 until catalog.length()) {
            val model = catalog.getJSONObject(index)
            if (model.optString("visibility") == "list" && model.optString("slug").isNotBlank()) {
                result.put(JSONObject().put("id", model.getString("slug")).put("name", model.optString("display_name", model.getString("slug"))))
            }
        }
        check(result.length() > 0) { "OpenAI did not return an available model for this account." }
        result
    }

    suspend fun ask(value: String, guardBody: ((() -> Unit) -> Unit)? = null) = runExclusive {
        require(value.length <= 120000) { "This conversation is too long. Start a new chat." }
        val proposed = JSONObject(value)
        if (proposed.has("owner")) {
            val record = session()
            check(record != null && record.has("access") && proposed.getString("owner") == owner(record)) {
                "The ChatGPT account changed. Open Coach and try again."
            }
        }
        val model = proposed.getString("model")
        require(model.matches(Regex("[A-Za-z0-9._:-]{1,160}"))) { "Choose an available ChatGPT model." }
        val messages = proposed.getJSONArray("messages")
        require(messages.length() in 1..13) { "Start a new chat and try again." }
        val input = JSONArray()
        for (index in 0 until messages.length()) {
            val message = messages.getJSONObject(index)
            val role = message.getString("role")
            val content = message.getString("content")
            require(role == if (index % 2 == 0) "user" else "assistant")
            require(content.isNotBlank() && content.length <= 60000)
            input.put(JSONObject().put("role", role).put("content", content))
        }
        require(messages.length() % 2 == 1)
        val payload = JSONObject().put("model", model).put("input", input).put("store", false).put("stream", true)
            .put("instructions", "You are the Sparky personal accountability coach. Use only the messages and optional context provided. Treat missing records as unknown. Give concrete, concise advice in plain text. Describe patterns cautiously and avoid medical diagnosis. You cannot change habits, calendar events, or records.")
        request("$RESOURCE/responses", payload.toString(), bearer = access(), eventStream = true, guardBody = guardBody, read = ::answer)
    }

    private suspend fun <T> runExclusive(block: suspend () -> T): T =
        withContext(Dispatchers.IO) {
            sessionMutex.withLock {
                try { block() }
                catch (cause: CancellationException) { throw cause }
                catch (cause: IllegalStateException) { throw cause }
                catch (_: java.io.IOException) { error("Could not reach OpenAI. Check your internet connection and try again.") }
                catch (_: Exception) { error("Sparky could not verify the OpenAI response or saved session.") }
            }
        }

    private fun access(): String {
        val record = session() ?: error("Connect an eligible ChatGPT account first.")
        check(record.has("access")) { "ChatGPT plan usage is disconnected. Sign in again." }
        if (System.currentTimeMillis() < record.getLong("expires") - 60_000) return record.getString("access")
        check(record.optString("refresh").isNotBlank()) { "Sign in again to renew this ChatGPT session." }
        val response = try {
            token(mapOf("grant_type" to "refresh_token", "client_id" to record.getString("client"),
                "refresh_token" to record.getString("refresh"), "resource" to RESOURCE))
        } catch (failure: OpenAiFailure) {
            if (failure.code == "invalid_grant" || failure.status == 401) {
                clearTokens(record)
                persist(record)
                error("Your ChatGPT session expired. Sign in again.")
            }
            throw failure
        }
        setTokens(record, response, mustGrant = false)
        persist(record)
        return record.getString("access")
    }

    private fun setTokens(record: JSONObject, response: JSONObject, mustGrant: Boolean) {
        val scopes = response.optString("scope", if (mustGrant) "" else record.optString("scope"))
        check(scopes.split(Regex("\\s+")).containsAll(requiredScopes)) {
            "OpenAI did not grant ChatGPT plan usage. Check your plan or approve usage when you sign in."
        }
        val access = response.optString("access_token")
        val expiry = response.optLong("expires_in")
        check(access.isNotBlank() && expiry in 1..86400 && response.optString("token_type").equals("Bearer", true)) {
            "OpenAI did not return a usable ChatGPT session."
        }
        record.put("access", access).put("expires", System.currentTimeMillis() + expiry * 1000)
            .put("scope", scopes).put("refresh", response.optString("refresh_token", record.optString("refresh")))
    }

    private fun clearTokens(record: JSONObject) {
        for (field in listOf("access", "refresh", "expires", "scope", "idToken")) record.remove(field)
    }

    private fun token(fields: Map<String, String>) =
        request("$ACCOUNTS/oauth/token", form(fields), formEncoded = true) { JSONObject(it.readSmall()) }

    private fun validateIdentity(jwt: String, client: String, nonce: String): JSONObject {
        val parts = jwt.split('.')
        check(parts.size == 3 && jwt.length < 24000) { "OpenAI returned an invalid identity token." }
        val header = JSONObject(decode(parts[0]).toString(Charsets.UTF_8))
        val claims = JSONObject(decode(parts[1]).toString(Charsets.UTF_8))
        check(header.optString("alg") == "RS256" && header.optString("kid").isNotBlank()) { "OpenAI returned an unsupported identity signature." }
        val keys = request("$ISSUER/.well-known/jwks.json") { JSONObject(it.readSmall()).getJSONArray("keys") }
        val key = (0 until keys.length()).map(keys::getJSONObject).firstOrNull {
            it.optString("kid") == header.optString("kid") && it.optString("kty") == "RSA" && it.optString("alg", "RS256") == "RS256"
        } ?: error("OpenAI’s identity signing key could not be verified.")
        val publicKey = KeyFactory.getInstance("RSA").generatePublic(
            RSAPublicKeySpec(BigInteger(1, decode(key.getString("n"))), BigInteger(1, decode(key.getString("e")))),
        )
        val verifier = Signature.getInstance("SHA256withRSA")
        verifier.initVerify(publicKey)
        verifier.update("${parts[0]}.${parts[1]}".toByteArray(Charsets.US_ASCII))
        check(verifier.verify(decode(parts[2]))) { "The OpenAI identity signature did not verify." }
        val audiences = claims.optJSONArray("aud")
        val matchingAudience = if (audiences == null) claims.optString("aud") == client
            else (0 until audiences.length()).any { audiences.optString(it) == client } &&
                (audiences.length() == 1 || claims.optString("azp") == client)
        val now = System.currentTimeMillis() / 1000
        check(claims.optString("iss") == ISSUER && matchingAudience && claims.optString("nonce") == nonce &&
            claims.optLong("exp") > now && claims.optLong("nbf", 0) <= now + 30 && claims.optString("sub").isNotBlank()) {
            "The OpenAI identity did not match this sign-in attempt."
        }
        return claims
    }

    private fun key(): SecretKey {
        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keystore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }

    private fun session(): JSONObject? {
        val active = prefs.getString("active", null) ?: return null
        return readRecord("account.$active")
    }

    private fun readRecord(field: String): JSONObject? {
        val encrypted = prefs.getString(field, null) ?: return null
        val parts = encrypted.split('.')
        check(parts.size == 2) { "The saved sign-in could not be read." }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, decode(parts[0])))
        cipher.updateAAD(field.toByteArray(Charsets.UTF_8))
        return JSONObject(cipher.doFinal(decode(parts[1])).toString(Charsets.UTF_8))
    }

    private fun persist(record: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val client = record.getString("client")
        val field = "account.$client"
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(field.toByteArray(Charsets.UTF_8))
        val encrypted = "${encode(cipher.iv)}.${encode(cipher.doFinal(record.toString().toByteArray(Charsets.UTF_8)))}"
        check(prefs.edit().putString(field, encrypted).putString("active", client).commit()) { "Could not save the ChatGPT session on this phone." }
    }
}

private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, BASE64_FLAGS)
private fun decode(text: String) = Base64.decode(text, BASE64_FLAGS)
private fun secret() = encode(ByteArray(32).also(random::nextBytes))
private fun form(fields: Map<String, String>) = fields.entries.joinToString("&") { (key, value) ->
    "${URLEncoder.encode(key, "UTF-8")}=${URLEncoder.encode(value, "UTF-8")}"
}

private fun receiveCallback(server: ServerSocket, state: String, connect: (Uri) -> Unit): Uri? {
    val deadline = System.nanoTime() + 170_000_000_000
    while (System.nanoTime() < deadline) {
        server.soTimeout = ((deadline - System.nanoTime()) / 1_000_000).coerceAtLeast(1).toInt()
        val socket = try { server.accept() } catch (_: SocketTimeoutException) { break }
        socket.use {
            it.soTimeout = 2500
            val line = runCatching { it.getInputStream().readRequestLine() }.getOrNull().orEmpty()
            val fields = line.split(' ', limit = 3)
            val target = fields.getOrNull(1).orEmpty()
            val uri = if (fields.firstOrNull() == "GET" && target.startsWith("$CALLBACK?")) Uri.parse("http://127.0.0.1$target") else null
            val valid = uri?.getQueryParameters("state")?.singleOrNull()?.let { candidate ->
                MessageDigest.isEqual(candidate.toByteArray(), state.toByteArray())
            } == true
            val denied = valid && uri?.getQueryParameter("error") != null
            val accepted = valid && !denied && uri?.getQueryParameters("code")?.singleOrNull()?.isNotBlank() == true &&
                uri.getQueryParameters("client_id").size <= 1
            val exchange = if (accepted) runCatching { connect(requireNotNull(uri)) } else null
            val offline = (exchange?.exceptionOrNull() as? OpenAiNetworkFailure)?.retrySafe == true
            val status = if (exchange?.isFailure == true && !offline) "502 Bad Gateway" else if (accepted || denied) "200 OK" else "400 Bad Request"
            val message = when {
                exchange?.isSuccess == true -> "ChatGPT is connected to Sparky."
                offline -> "Almost done. Return to Sparky to finish connecting."
                accepted -> "Sparky could not finish connecting. Open Coach to see what happened."
                denied -> "Sign-in was cancelled."
                else -> "This link does not match the sign-in in progress."
            }
            runCatching {
                val back = if (accepted || denied) "<p><a href=\"intent://coach/return#Intent;scheme=onelifedaybook;package=app.onelife.daybook;end\">Open Sparky Coach</a></p><p>You can also open Sparky from your home screen.</p>" else ""
                val page = "<!doctype html><html lang=\"en\"><meta name=\"viewport\" content=\"width=device-width\"><title>Sparky</title><body style=\"font:18px system-ui;padding:24px\"><p>$message</p>$back</body></html>"
                val body = page.toByteArray(Charsets.UTF_8)
                it.getOutputStream().apply {
                    write(("HTTP/1.1 $status\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n" +
                        "Referrer-Policy: no-referrer\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n").toByteArray())
                    write(body)
                    flush()
                }
            }
            if (denied) error("ChatGPT sign-in was declined or cancelled.")
            if (offline) return uri
            if (exchange != null) { exchange.getOrThrow(); return null }
        }
    }
    error("ChatGPT sign-in timed out. Return to Sparky and try again.")
}

private fun InputStream.readRequestLine(): String {
    val input = buffered()
    val line = StringBuilder()
    var bytes = 0
    var first = true
    var characters = 0
    while (bytes++ < 32000) {
        val byte = input.read()
        if (byte == -1) break
        if (byte == 10) {
            if (characters == 0 && !first) return line.toString()
            characters = 0
            first = false
        } else if (byte != 13) {
            characters++
            if (first) line.append(byte.toChar())
        }
    }
    return ""
}

/** Where a ChatGPT sign-in is, so Coach can show progress: browser, finishing, waiting (network blocked) or "". */
@Volatile internal var chatConnectStage = ""

private class OpenAiFailure(val status: Int, val code: String, message: String) : IllegalStateException(message)

/** The request failed on this phone's network. retrySafe: it never reached OpenAI, so a one-time code is still unused. */
internal class OpenAiNetworkFailure(message: String, cause: java.io.IOException) : IllegalStateException(message, cause) {
    val retrySafe = cause is UnknownHostException || cause is ConnectException
}

/** Retries [block] while the network is blocked (for up to [timeoutMs]), for example until Sparky is back in front. */
internal suspend fun <T> retryWhileOffline(timeoutMs: Long = 150_000, pauseMs: Long = 1_000, block: () -> T): T {
    val deadline = System.nanoTime() + timeoutMs * 1_000_000
    while (true) {
        try {
            return block()
        } catch (failure: OpenAiNetworkFailure) {
            if (!failure.retrySafe || System.nanoTime() > deadline) throw failure
            kotlinx.coroutines.delay(pauseMs)
        }
    }
}

private fun explainError(code: String, status: Int = 0) = when {
    code == "subscription_sharing_user_not_eligible" -> "This ChatGPT account or workspace is not eligible to share plan usage with Sparky."
    code == "subscription_sharing_usage_limit_exceeded" || status == 429 -> "ChatGPT plan usage is temporarily limited. Check your ChatGPT usage settings."
    code == "subscription_sharing_usage_unavailable" -> "ChatGPT plan usage is currently unavailable. Check your ChatGPT usage settings."
    status == 401 -> "ChatGPT did not accept this session. Sign out and sign in again."
    else -> "OpenAI could not complete this request${if (status > 0) " (HTTP $status)" else ""}. Try again or check your plan settings."
}

private val standardClient = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false)
    .connectTimeout(15, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS).callTimeout(50, TimeUnit.SECONDS)
    .build()
private val streamingClient = standardClient.newBuilder().readTimeout(60, TimeUnit.SECONDS)
    .callTimeout(105, TimeUnit.SECONDS).build()

private fun operation(url: String) = when {
    url.endsWith("/oauth/token") -> "sign-in exchange"
    url.endsWith("/jwks.json") -> "identity verification"
    url.endsWith("/openid-configuration") -> "sign-in connection check"
    url.endsWith("/oauth/revoke") -> "sign-out"
    url.endsWith("/models") -> "model lookup"
    else -> "answer"
}

private fun <T> request(url: String, body: String? = null, bearer: String? = null, formEncoded: Boolean = false,
                        eventStream: Boolean = false, guardBody: ((() -> Unit) -> Unit)? = null, read: (BufferedReader) -> T): T {
    val stage = operation(url)
    val builder = Request.Builder().url(url).header("Accept", if (eventStream) "text/event-stream" else "application/json")
    bearer?.let { builder.header("Authorization", "Bearer $it") }
    if (body != null) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        val type = (if (formEncoded) "application/x-www-form-urlencoded" else "application/json").toMediaType()
        builder.post(object : RequestBody() {
            override fun contentType() = type
            override fun contentLength() = bytes.size.toLong()
            override fun isOneShot() = true
            override fun writeTo(sink: BufferedSink) {
                if (guardBody == null) sink.write(bytes) else guardBody { sink.write(bytes) }
            }
        })
    }
    try {
        val client = if (eventStream) streamingClient else standardClient
        return client.newCall(builder.build()).execute().use { response ->
            val responseBody = response.body
            if (!response.isSuccessful) {
                val code = runCatching {
                    val data = JSONObject(responseBody?.charStream()?.buffered()?.readSmall().orEmpty())
                    data.optJSONObject("error")?.optString("code") ?: data.optString("error")
                }.getOrNull().orEmpty()
                val message = if (response.header("cf-mitigated") == "challenge" ||
                    (response.code == 403 && responseBody?.contentType()?.subtype == "html")) {
                    "OpenAI’s verification gateway blocked the $stage (HTTP 403)."
                } else "${explainError(code, response.code)} (Step: $stage)"
                throw OpenAiFailure(response.code, code, message)
            }
            val reader = responseBody?.charStream()?.buffered() ?: error("OpenAI returned no body for $stage.")
            reader.use(read)
        }
    } catch (failure: java.io.IOException) {
        val reason = when (failure) {
            is UnknownHostException -> "the app could not resolve OpenAI’s address (DNS). If this keeps happening with Sparky open, check that a VPN, ad blocker, Private DNS or data saver setting is not blocking Sparky"
            is SSLException -> "the secure connection could not be verified (TLS)"
            is SocketTimeoutException -> "OpenAI did not reply in time (timeout)"
            is ConnectException -> "the app could not open a connection"
            else -> "the connection ended before OpenAI completed the request"
        }
        throw OpenAiNetworkFailure("The OpenAI $stage failed because $reason.", failure)
    }
}

private fun BufferedReader.readSmall(): String {
    val result = StringBuilder()
    val buffer = CharArray(4096)
    while (true) {
        val count = read(buffer)
        if (count == -1) return result.toString()
        check(result.length + count <= 1_000_000) { "OpenAI’s response was too large." }
        result.append(buffer, 0, count)
    }
}

private fun answer(reader: BufferedReader): String {
    val text = StringBuilder()
    val event = StringBuilder()
    while (true) {
        val line = reader.readLine() ?: break
        if (line.startsWith("data:")) {
            if (event.isNotEmpty()) event.append('\n')
            event.append(line.substring(5).trimStart())
            check(event.length <= 1_000_000) { "OpenAI’s response was too large." }
        } else if (line.isEmpty() && event.isNotEmpty()) {
            val raw = event.toString()
            event.clear()
            if (raw == "[DONE]") break
            val data = JSONObject(raw)
            when (data.optString("type")) {
                "response.output_text.delta", "response.refusal.delta" -> {
                    if (text.length < 30000) text.append(data.optString("delta").take(30000 - text.length))
                }
                "response.completed" -> {
                    check(text.isNotBlank()) { "ChatGPT finished without a text answer. Try a different model." }
                    return text.toString()
                }
                "response.failed", "response.incomplete", "error" -> {
                    val code = data.optJSONObject("response")?.optJSONObject("error")?.optString("code") ?: data.optString("code")
                    error(explainError(code))
                }
            }
        }
    }
    error("The connection ended before ChatGPT completed the answer. Try again.")
}
