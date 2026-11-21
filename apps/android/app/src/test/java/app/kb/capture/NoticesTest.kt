package app.kb.capture

import app.kb.capture.delivery.Answer
import app.kb.capture.delivery.Deliverer
import app.kb.capture.delivery.Notices
import app.kb.capture.pairing.Pairing
import app.kb.capture.queue.QueuedCapture
import org.junit.Assert.assertEquals
import org.junit.Test

/** What delivery tells the person: each refusal once, and a pause once, however many runs follow. */
class NoticesTest {
    private val root = tempDir()
    private val queue = newQueue(root)
    private val pairings = newPairings(root)
    private val host = FakeHost()
    private val told = mutableListOf<String>()
    private val notices =
        object : Notices {
            override fun refused(entry: QueuedCapture, store: Pairing, reason: String) {
                told += "refused ${entry.capture.summary()} by ${store.name}: $reason"
            }

            override fun paused(store: Pairing, reason: String) {
                told += "paused ${store.name}: $reason"
            }
        }
    private val deliverer = Deliverer(queue, pairings, host, notices)

    init {
        pairings.save("personal", "Personal", "https://kb.tail.ts.net", "tok", listOf(1), "2026-11-20T08:00:00.000+07:00")
    }

    @Test
    fun `a capture the host refuses is told once, with the host's reason`() {
        host.submit = { Answer.Refused("invalid_input", "capture has no text, URL or files") }
        queue.enqueue(mixedDraft().copy(title = "Venue list"), "personal")
        deliverer.deliverAll()
        deliverer.deliverAll()
        assertEquals(listOf("refused Venue list by Personal: invalid_input: capture has no text, URL or files"), told)
    }

    @Test
    fun `a store that stops accepting this phone is told once, not on every run after`() {
        host.manifest = Answer.Unauthorized("capture device credential is invalid or revoked")
        queue.enqueue(mixedDraft(), "personal")
        queue.enqueue(mixedDraft(), "personal")
        deliverer.deliverAll()
        deliverer.deliverAll()
        assertEquals(listOf("paused Personal: capture device credential is invalid or revoked"), told)
    }

    @Test
    fun `a capture that goes through tells nothing`() {
        queue.enqueue(mixedDraft(), "personal")
        deliverer.deliverAll()
        assertEquals(emptyList<String>(), told)
    }
}
