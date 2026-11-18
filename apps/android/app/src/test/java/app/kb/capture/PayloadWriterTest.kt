package app.kb.capture

import app.kb.capture.capture.CAPTURE_CONTRACT
import app.kb.capture.capture.CaptureDraft
import app.kb.capture.capture.CaptureTarget
import app.kb.capture.capture.PayloadWriter
import java.io.ByteArrayOutputStream
import java.util.Base64
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PayloadWriterTest {
    private fun bodyOf(draft: CaptureDraft, store: String? = null): JsonObject {
        val root = tempDir()
        val queue = newQueue(root)
        val entry = queue.enqueue(draft, store)
        val capture = entry.capture.copy(target = store?.let { CaptureTarget(store = it) })
        val out = ByteArrayOutputStream()
        PayloadWriter.write(capture, { queue.openFile(capture.captureId, it) }, out)
        return PayloadWriter.json.parseToJsonElement(out.toString(Charsets.UTF_8)).jsonObject
    }

    @Test
    fun `the body is one capture submit call carrying the raw share unchanged`() {
        val body = bodyOf(mixedDraft(), store = "personal")
        assertEquals("capture.submit", body["id"]!!.jsonPrimitive.content)
        val input = body["input"]!!.jsonObject
        assertEquals(CAPTURE_CONTRACT, input["version"]!!.jsonPrimitive.int)
        assertEquals("Line one\nLine two · ünïcödé 🌱\n", input["text"]!!.jsonPrimitive.content)
        assertEquals("https://example.com/a?b=c&d=e", input["url"]!!.jsonPrimitive.content)
        assertEquals("Example \"quoted\" title", input["title"]!!.jsonPrimitive.content)
        assertEquals("com.android.chrome", input["source"]!!.jsonObject["app"]!!.jsonPrimitive.content)
        assertEquals("personal", input["target"]!!.jsonObject["store"]!!.jsonPrimitive.content)
        assertEquals("2026-11-19T08:30:00.000+07:00", input["capturedAt"]!!.jsonPrimitive.content)
        assertTrue(input["captureId"]!!.jsonPrimitive.content.startsWith("cap-1"))
    }

    @Test
    fun `files keep their order, names, types and exact bytes`() {
        val files = bodyOf(mixedDraft())["input"]!!.jsonObject["files"]!!.jsonArray.map { it.jsonObject }
        assertEquals(listOf("first.png", "second.jpg"), files.map { it["name"]!!.jsonPrimitive.content })
        assertEquals(listOf("image/png", "image/jpeg"), files.map { it["mime"]!!.jsonPrimitive.content })
        assertArrayEquals(PNG, Base64.getDecoder().decode(files[0]["bytes"]!!.jsonPrimitive.content))
        assertArrayEquals(JPG, Base64.getDecoder().decode(files[1]["bytes"]!!.jsonPrimitive.content))
        assertFalse("the local path never reaches the wire", files[0].containsKey("path"))
    }

    @Test
    fun `what the share did not supply is absent, not null or empty`() {
        val input = bodyOf(CaptureDraft(text = "just text", url = "", title = ""))["input"]!!.jsonObject
        assertEquals(setOf("version", "captureId", "capturedAt", "text"), input.keys)
    }

    @Test
    fun `a share with nothing in it is refused before it is queued`() {
        val root = tempDir()
        assertThrows(IllegalArgumentException::class.java) { newQueue(root).enqueue(CaptureDraft(text = "", title = "only a title"), null) }
    }
}
