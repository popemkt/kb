package app.kb.capture

import app.kb.capture.capture.CaptureDraft
import app.kb.capture.pairing.Pairings
import app.kb.capture.queue.CaptureQueue
import app.kb.capture.queue.QueuedCapture
import app.kb.capture.queue.Receipt
import app.kb.capture.queue.Status
import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Power is cut before every step of each queue and pairing operation, and
 * every disk a reboot could then find is opened again. What was acknowledged
 * must be there; what was not must be whole or absent; and a capture's bytes
 * are never gone while it is still pending.
 */
class DurabilityTest {
    private val root = File("/q")
    private val clock = TickingClock()

    private fun queueOn(disk: CrashDisk): CaptureQueue {
        var n = 0
        return CaptureQueue(root, disk, now = clock::now, newId = { "cap-${++n}" })
    }

    /** Runs [op] once to count its steps, then again with the power cut before each one, checking every reboot. */
    private fun sweep(setup: CrashDisk, op: (CrashDisk) -> Unit, check: (reboot: CrashDisk, acknowledged: Boolean) -> Unit): Int {
        val probe = setup.fork()
        op(probe)
        val n = probe.steps - setup.steps
        for (k in 0..n) {
            val disk = setup.fork().also { it.crashAt = setup.steps + k }
            val acknowledged =
                try {
                    op(disk)
                    true
                } catch (_: Crash) {
                    false
                }
            assertEquals("step $k of $n", k == n, acknowledged)
            disk.crashImages().forEachIndexed { i, image ->
                try {
                    check(image, acknowledged)
                } catch (e: AssertionError) {
                    throw AssertionError("power cut before step $k of $n, reboot image $i: ${e.message}", e)
                }
            }
        }
        return n
    }

    private fun assertWhole(entry: QueuedCapture, queue: CaptureQueue) {
        if (entry.state.status == Status.Sent) return
        val files = entry.capture.files
        assertEquals(2, files.size)
        assertArrayEquals("pending capture lost its first file", PNG, queue.openFile(entry.capture.captureId, files[0]).readBytes())
        assertArrayEquals("pending capture lost its second file", JPG, queue.openFile(entry.capture.captureId, files[1]).readBytes())
    }

    private fun queued(): Pair<CrashDisk, String> {
        val disk = CrashDisk()
        val id = queueOn(disk).enqueue(mixedDraft(), "personal").capture.captureId
        return disk to id
    }

    @Test
    fun `a share is queued whole or not at all, and once acknowledged it survives`() {
        val steps =
            sweep(CrashDisk(), { disk -> queueOn(disk).enqueue(mixedDraft(), "personal") }) { image, acknowledged ->
                val queue = queueOn(image)
                val entries = queue.all()
                if (acknowledged) assertEquals("the toast said Queued", 1, entries.size)
                assertTrue(entries.size <= 1)
                entries.forEach { assertWhole(it, queue) }
                assertTrue("staging is cleared on start", image.list(File(root, "staging")).isEmpty())
            }
        assertTrue("the sweep cut the power at many points", steps > 10)
    }

    @Test
    fun `Sent is durable before the bytes are released`() {
        val (setup, id) = queued()
        sweep(setup, { disk -> queueOn(disk).markSent(id, Receipt("01NODE", "personal")) }) { image, acknowledged ->
            val queue = queueOn(image)
            val entry = queue.get(id)
            assertNotNull("the capture is never lost", entry)
            entry!!
            if (acknowledged) assertEquals(Status.Sent, entry.state.status)
            assertWhole(entry, queue)
            if (entry.state.status == Status.Sent) {
                assertEquals("01NODE", entry.state.receipt?.nodeId)
                assertTrue("a reboot finishes the release", image.list(File(root, "entries/$id/files")).isEmpty())
            }
        }
    }

    @Test
    fun `a state change is the old state or the new one, never lost`() {
        val (setup, id) = queued()
        sweep(setup, { disk -> queueOn(disk).update(id) { it.copy(attempts = 5, reason = "timeout") } }) { image, acknowledged ->
            val queue = queueOn(image)
            val entry = queue.get(id) ?: return@sweep fail("the capture was lost")
            assertTrue(entry.state.attempts in setOf(0, 5))
            if (acknowledged) assertEquals(5, entry.state.attempts)
            assertWhole(entry, queue)
        }
    }

    @Test
    fun `a discard removes the whole capture or leaves it whole`() {
        val (setup, id) = queued()
        sweep(setup, { disk -> queueOn(disk).discard(id) }) { image, acknowledged ->
            val queue = queueOn(image)
            val entry = queue.get(id)
            if (acknowledged) assertEquals(null, entry)
            entry?.let { assertWhole(it, queue) }
        }
    }

    @Test
    fun `a pairing survives once saved, since its one-use code is spent`() {
        val file = File("/p/pairings.json")
        val setup = CrashDisk().also { Pairings(file, PlainVault, it).save("a", "A", "https://a", "tok-a", listOf(1), "t0") }
        sweep(setup, { disk -> Pairings(file, PlainVault, disk).save("b", "B", "https://b", "tok-b", listOf(1), "t1") }) { image, acknowledged ->
            val keys = Pairings(file, PlainVault, image).all.value.map { it.key }
            if (acknowledged) assertEquals(listOf("b", "a"), keys) else assertTrue("old or new, got $keys", keys == listOf("a") || keys == listOf("b", "a"))
        }
    }

    @Test
    fun `without the directory syncs a crash could lose an acknowledged share`() {
        // The model is not vacuous: the same enqueue on a disk whose directory syncs do nothing loses the capture.
        val disk = CrashDisk()
        queueOn(disk).enqueue(CaptureDraft(text = "kept?"), null)
        val image = disk.crashImages().first()
        assertEquals(1, queueOn(image).all().size)
        val careless = NoDirSync(CrashDisk())
        CaptureQueue(root, careless, now = clock::now, newId = { "x" }).enqueue(CaptureDraft(text = "lost"), null)
        assertEquals(0, queueOn(careless.inner.crashImages().first()).all().size)
    }

    /** A disk that skips directory syncs, as the code did before. */
    private class NoDirSync(val inner: CrashDisk) : app.kb.capture.storage.Disk by inner {
        override fun syncDir(dir: File) = Unit
    }
}
