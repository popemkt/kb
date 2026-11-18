package app.kb.capture

import app.kb.capture.capture.CaptureDraft
import app.kb.capture.capture.FileSource
import app.kb.capture.queue.Receipt
import app.kb.capture.queue.Status
import java.io.File
import java.io.IOException
import java.io.InputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureQueueTest {
    @Test
    fun `a queued capture survives a restart with its bytes and state`() {
        val root = tempDir()
        val id = newQueue(root).enqueue(mixedDraft(), "personal").capture.captureId
        val reopened = newQueue(root)
        val entry = reopened.get(id)!!
        assertEquals(Status.Pending, entry.state.status)
        assertEquals("personal", entry.state.store)
        assertEquals(2, entry.capture.files.size)
        assertArrayEquals(PNG, reopened.openFile(id, entry.capture.files[0]).readBytes())
        assertArrayEquals(JPG, reopened.openFile(id, entry.capture.files[1]).readBytes())
        assertEquals(listOf(id), reopened.items.value.map { it.capture.captureId })
    }

    @Test
    fun `a file that fails mid-copy leaves no entry and no staging behind`() {
        val root = tempDir()
        val queue = newQueue(root)
        val breaking =
            FileSource("broken.png", "image/png") {
                object : InputStream() {
                    var n = 0

                    override fun read(): Int = if (n++ < 100) 1 else throw IOException("grant revoked")
                }
            }
        assertThrows(IOException::class.java) {
            queue.enqueue(CaptureDraft(text = "x", files = listOf(bytesFile("ok.png", "image/png", PNG), breaking)), null)
        }
        assertTrue(queue.all().isEmpty())
        assertTrue(File(root, "staging").listFiles()!!.isEmpty())
    }

    @Test
    fun `a crash before publish is cleared on the next start, and published entries are untouched`() {
        val root = tempDir()
        val kept = newQueue(root).enqueue(CaptureDraft(text = "kept"), null).capture.captureId
        // A crash between copying bytes and the publishing rename leaves a staging directory.
        File(root, "staging/half/files").mkdirs()
        File(root, "staging/half/files/0").writeBytes(PNG)
        // A crash during discard leaves a directory in trash.
        File(root, "trash/gone").mkdirs()
        // A crash during a state write leaves a temporary file beside state.json.
        File(root, "entries/$kept/state.json.tmp").writeText("{")
        val queue = newQueue(root)
        assertEquals(listOf(kept), queue.all().map { it.capture.captureId })
        assertTrue(File(root, "staging").listFiles()!!.isEmpty())
        assertTrue(File(root, "trash").listFiles()!!.isEmpty())
        assertFalse(File(root, "entries/$kept/state.json.tmp").exists())
    }

    @Test
    fun `sent releases the copied bytes and keeps the receipt`() {
        val root = tempDir()
        val queue = newQueue(root)
        val id = queue.enqueue(mixedDraft(), "personal").capture.captureId
        queue.markSent(id, Receipt(nodeId = "01NODE", store = "personal"))
        val entry = newQueue(root).get(id)!!
        assertEquals(Status.Sent, entry.state.status)
        assertEquals("01NODE", entry.state.receipt!!.nodeId)
        assertFalse(File(root, "entries/$id/files").exists())
        assertEquals("the raw share stays readable for the list", "Example \"quoted\" title", entry.capture.title)
    }

    @Test
    fun `state changes are atomic replacements and leave no temporary files`() {
        val root = tempDir()
        val queue = newQueue(root)
        val id = queue.enqueue(CaptureDraft(text = "t"), null).capture.captureId
        repeat(5) { n -> queue.update(id) { it.copy(attempts = n + 1, reason = "try $n") } }
        assertEquals(5, newQueue(root).get(id)!!.state.attempts)
        assertEquals(listOf("capture.json", "files", "state.json"), File(root, "entries/$id").list()!!.sorted())
    }

    @Test
    fun `discard removes the entry for good`() {
        val root = tempDir()
        val queue = newQueue(root)
        val id = queue.enqueue(mixedDraft(), null).capture.captureId
        queue.discard(id)
        assertNull(newQueue(root).get(id))
        assertTrue(queue.items.value.isEmpty())
    }

    @Test
    fun `the first pairing adopts captures queued before it, and only those`() {
        val root = tempDir()
        val queue = newQueue(root)
        val loose = queue.enqueue(CaptureDraft(text = "before pairing"), null).capture.captureId
        val pinned = queue.enqueue(CaptureDraft(text = "pinned to A"), "a").capture.captureId
        queue.pinUnpinned("b")
        assertEquals("b", queue.get(loose)!!.state.store)
        assertEquals("a", queue.get(pinned)!!.state.store)
    }

    @Test
    fun `entries list newest first`() {
        val root = tempDir()
        val queue = newQueue(root)
        val first = queue.enqueue(CaptureDraft(text = "1"), null).capture.captureId
        val second = queue.enqueue(CaptureDraft(text = "2"), null).capture.captureId
        assertEquals(listOf(second, first), queue.all().map { it.capture.captureId })
    }
}
