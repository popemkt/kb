package app.kb.capture

import app.kb.capture.delivery.Answer
import app.kb.capture.delivery.Deliverer
import app.kb.capture.delivery.Pairer
import app.kb.capture.queue.Status
import app.kb.capture.shell.Shell
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The shell page's moves over the real queue and pairings, against a scripted host. */
class ShellTest {
    private val root = tempDir()
    private val queue = newQueue(root)
    private val pairings = newPairings(root)
    private val host = FakeHost()
    private var runs = 0
    private val shell = Shell(queue, pairings, Pairer(queue, pairings, host), deliverSoon = { runs++ }, deviceName = "Pixel")

    @Test
    fun `pairing records the store as current, names the device, and starts delivery`() {
        val paired = shell.pair("https://kb.tail.ts.net/", "a".repeat(32))
        assertTrue(paired.ok)
        assertEquals("Paired · Personal", paired.message)
        val pair = host.calls.single { it.first == "capture.pair" }
        assertEquals("Pixel", pair.third["input"]!!.toString().let { Regex("\"deviceName\":\"([^\"]+)\"").find(it)!!.groupValues[1] })
        val store = shell.state().stores.single()
        assertEquals("https://kb.tail.ts.net", store.url)
        assertTrue(store.current)
        assertTrue(store.ok)
        assertEquals(1, runs)
    }

    @Test
    fun `a refused pairing says why and records nothing`() {
        host.pair = Answer.Refused("forbidden", "capture pairing code is invalid, expired or already used")
        val paired = shell.pair("https://kb.tail.ts.net", "b".repeat(32))
        assertFalse(paired.ok)
        assertTrue(paired.message, paired.message.contains("invalid, expired or already used"))
        assertTrue(shell.state().stores.isEmpty())
        assertEquals(0, runs)
    }

    @Test
    fun `a typed note is queued for the current store, retried and discarded`() {
        shell.pair("https://kb.tail.ts.net", "c".repeat(32))
        val id = shell.enqueue("Call Lan about the venue").capture.captureId
        val pending = shell.state().entries.single()
        assertEquals("pending", pending.status)
        assertEquals("Personal", pending.store)
        assertEquals(1, shell.state().pending)

        host.submit = { Answer.Refused("invalid_input", "capture has no text, URL or files") }
        Deliverer(queue, pairings, host).deliverAll()
        val failed = shell.state()
        assertEquals("failed", failed.entries.single().status)
        assertEquals(1, failed.failed)

        val before = runs
        shell.retry(id)
        assertEquals(Status.Pending, queue.get(id)!!.state.status)
        assertEquals(before + 1, runs)

        shell.discard(id)
        assertTrue(shell.state().entries.isEmpty())
    }

    @Test
    fun `a store that refused this phone shows as paused, and one on another contract says so`() {
        shell.pair("https://kb.tail.ts.net", "d".repeat(32))
        pairings.update("personal") { it.copy(paused = "capture device credential is invalid or revoked") }
        val paused = shell.state().stores.single()
        assertFalse(paused.ok)
        assertTrue(paused.status, paused.status.startsWith("Paused: capture device credential"))

        pairings.update("personal") { it.copy(paused = null, accepts = listOf(2)) }
        val ahead = shell.state().stores.single()
        assertFalse(ahead.ok)
        assertEquals("Personal accepts v2. This capture uses v1. Shares stay queued.", ahead.status)
    }
}
