package app.kb.capture.capture

import java.io.FilterOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement

/**
 * Writes the `POST /api/action` body that delivers one capture:
 * `{"id":"capture.submit","input":<raw payload>}`, the raw payload's files as
 * `{name, mime, bytes}` with the bytes base64-encoded.
 *
 * The file bytes are streamed from the queue entry straight into the request,
 * so a 25 MiB photo is never held in memory twice.
 */
object PayloadWriter {
    val json = Json {
        explicitNulls = false
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    fun write(capture: RawCapture, openFile: (StagedFile) -> InputStream, out: OutputStream) {
        val fields: JsonObject = json.encodeToJsonElement(capture.copy(files = emptyList())) as JsonObject
        out.text("{\"id\":")
        out.json(JsonPrimitive(CAPTURE_SUBMIT))
        out.text(",\"input\":{")
        var first = true
        for ((key, value) in fields) {
            if (key == "files") continue
            if (!first) out.text(",")
            first = false
            out.json(JsonPrimitive(key))
            out.text(":")
            out.json(value)
        }
        if (capture.files.isNotEmpty()) {
            if (!first) out.text(",")
            out.text("\"files\":[")
            capture.files.forEachIndexed { index, file ->
                if (index > 0) out.text(",")
                out.text("{\"name\":")
                out.json(JsonPrimitive(file.name))
                out.text(",\"mime\":")
                out.json(JsonPrimitive(file.mime))
                out.text(",\"bytes\":\"")
                Base64.getEncoder().wrap(Unclosable(out)).use { encoded ->
                    openFile(file).use { it.copyTo(encoded) }
                }
                out.text("\"}")
            }
            out.text("]")
        }
        out.text("}}")
        out.flush()
    }

    private fun OutputStream.text(s: String) = write(s.toByteArray(Charsets.UTF_8))

    private fun OutputStream.json(e: JsonElement) = text(json.encodeToString(JsonElement.serializer(), e))

    /** Closing the base64 encoder writes its padding; it must not close the request body with it. */
    private class Unclosable(out: OutputStream) : FilterOutputStream(out) {
        override fun write(b: ByteArray, off: Int, len: Int) = out.write(b, off, len)

        override fun close() = flush()
    }
}
