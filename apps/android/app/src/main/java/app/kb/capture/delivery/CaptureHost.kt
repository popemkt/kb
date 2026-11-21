package app.kb.capture.delivery

import app.kb.capture.capture.PayloadWriter
import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * What a kb host answered one action call, in the four ways delivery treats
 * differently. A host's receipt ([ActionReceipt] on the kb side) is either
 * [Ok] or [Refused]; the other two are about reaching it at all.
 */
sealed interface Answer {
    /** `status: "succeeded"`, with the action's output. */
    data class Ok(val output: JsonElement) : Answer

    /** `status: "failed"`: the host decided, with kb's failure code and message. */
    data class Refused(val code: String, val message: String) : Answer

    /** The host would not take this device's credential (HTTP 401/403, or `forbidden`). */
    data class Unauthorized(val message: String) : Answer

    /** No answer: offline, timed out, a 5xx, or something that is not a kb host. Worth trying again. */
    data class Unreachable(val message: String) : Answer
}

/** One kb host's action endpoint, `POST <store>/api/action`, on the program wire. */
fun interface CaptureHost {
    /** Calls [action] with the input [writeInput] streams, as the holder of [token] when there is one. */
    fun call(url: String, token: String?, action: String, writeInput: (OutputStream) -> Unit): Answer

    companion object {
        /** The versions of the capture contract a `kb.manifest` output says the host accepts; empty when it names none. */
        fun acceptedContracts(manifest: JsonElement): List<Int> =
            when (val c = (manifest as? JsonObject)?.get("captureContract")) {
                is JsonPrimitive -> listOfNotNull(c.intOrNull)
                is JsonArray -> c.mapNotNull { (it as? JsonPrimitive)?.intOrNull }
                else -> emptyList()
            }

        /** Wraps an input already in hand as the full `{id, input}` body. */
        fun body(action: String, input: JsonElement): (OutputStream) -> Unit = { out ->
            val request = JsonObject(mapOf("id" to JsonPrimitive(action), "input" to input))
            out.write(PayloadWriter.json.encodeToString(JsonElement.serializer(), request).toByteArray())
        }
    }
}

/**
 * [CaptureHost] over `HttpURLConnection`. It sends no `Origin`, so the host
 * reads the call as a program's, and the device credential as a bearer token.
 * The body is streamed in chunks, so a capture's files are never buffered.
 */
class HttpCaptureHost(private val timeoutMs: Int = 30_000) : CaptureHost {
    override fun call(url: String, token: String?, action: String, writeInput: (OutputStream) -> Unit): Answer {
        val endpoint =
            try {
                URL(url.trimEnd('/') + "/api/action")
            } catch (e: Exception) {
                return Answer.Unreachable("Not a URL: $url")
            }
        val conn = endpoint.openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs * 4
            conn.setChunkedStreamingMode(64 * 1024)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.buffered().use(writeInput)
            val status = conn.responseCode
            val text = (if (status in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            interpret(status, text)
        } catch (e: IOException) {
            Answer.Unreachable(e.message ?: e.javaClass.simpleName)
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        /** Reads an HTTP status and body as an [Answer]; pure, so the decision is tested without a network. */
        fun interpret(status: Int, text: String): Answer {
            val receipt =
                try {
                    PayloadWriter.json.parseToJsonElement(text).jsonObject
                } catch (_: Exception) {
                    null
                }
            val kind = receipt?.get("status")?.let { (it as? JsonPrimitive)?.content }
            return when {
                status == 401 || status == 403 ->
                    Answer.Unauthorized(receipt?.get("message")?.let { (it as? JsonPrimitive)?.content } ?: "HTTP $status")
                kind == "succeeded" -> Answer.Ok(receipt["output"] ?: JsonObject(emptyMap()))
                kind == "failed" -> {
                    val code = receipt["code"]?.jsonPrimitive?.content ?: "internal"
                    val message = receipt["message"]?.jsonPrimitive?.content ?: code
                    when (code) {
                        "forbidden" -> Answer.Unauthorized(message)
                        "internal" -> Answer.Unreachable("host error: $message")
                        else -> Answer.Refused(code, message)
                    }
                }
                status in 500..599 -> Answer.Unreachable("HTTP $status")
                else -> Answer.Unreachable("Not a kb host (HTTP $status)")
            }
        }
    }
}
