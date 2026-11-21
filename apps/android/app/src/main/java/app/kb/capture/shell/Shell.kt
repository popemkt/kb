package app.kb.capture.shell

import app.kb.capture.capture.CAPTURE_CONTRACT
import app.kb.capture.capture.CaptureDraft
import app.kb.capture.delivery.Deliverer
import app.kb.capture.delivery.PairOutcome
import app.kb.capture.delivery.Pairer
import app.kb.capture.pairing.Pairing
import app.kb.capture.pairing.Pairings
import app.kb.capture.queue.CaptureQueue
import app.kb.capture.queue.QueuedCapture
import app.kb.capture.queue.Status
import kotlinx.serialization.Serializable

/** A paired store as the shell's page lists it. [ok] is false while its captures cannot go out. */
@Serializable
data class StoreView(
    val key: String,
    val name: String,
    val url: String,
    val current: Boolean,
    val status: String,
    val ok: Boolean,
)

/** One queued capture as the page lists it. [status] is `pending`, `sent` or `failed`. */
@Serializable
data class EntryView(
    val id: String,
    val summary: String,
    val store: String,
    val capturedAt: String,
    val status: String,
    val reason: String? = null,
    val nodeId: String? = null,
    val files: Int = 0,
    val source: String? = null,
    val attempts: Int = 0,
)

/** Everything the shell's page shows, newest capture first. */
@Serializable
data class ShellState(val stores: List<StoreView>, val entries: List<EntryView>, val pending: Int, val failed: Int)

/** What pairing came to, as the page shows it. */
@Serializable
data class PairView(val ok: Boolean, val message: String, val store: StoreView? = null)

/**
 * What the shell's own page may ask of the capture core: the paired stores,
 * pairing and forgetting one, and the queue with its three moves (queue a
 * note, retry a failed capture, discard one). Plain data in and out, so the
 * page's plugin ([ShellPlugin]) only translates, and this is tested on the
 * JVM. The core it drives is unchanged: [CaptureQueue], [Pairings], [Pairer]
 * and the delivery that [deliverSoon] starts.
 */
class Shell(
    private val queue: CaptureQueue,
    private val pairings: Pairings,
    private val pairer: Pairer,
    private val deliverSoon: () -> Unit,
    private val deviceName: String,
) {
    fun state(): ShellState {
        val stores = pairings.all.value
        val entries = queue.all().sortedByDescending { it.capture.capturedAt }
        return ShellState(
            stores = stores.mapIndexed { index, p -> storeView(p, current = index == 0) },
            entries = entries.map { entryView(it, stores) },
            pending = entries.count { it.state.status == Status.Pending },
            failed = entries.count { it.state.status == Status.Failed },
        )
    }

    fun pair(url: String, code: String): PairView =
        when (val outcome = pairer.pair(url, code, deviceName)) {
            is PairOutcome.Paired -> {
                deliverSoon()
                PairView(true, "Paired · ${outcome.pairing.name}", storeView(outcome.pairing, current = true))
            }
            is PairOutcome.Failed -> PairView(false, outcome.reason)
        }

    fun forget(key: String) = pairings.forget(key)

    /** Queues a typed note for the current store, as a share would be. */
    fun enqueue(text: String): QueuedCapture {
        val queued = queue.enqueue(CaptureDraft(text = text), pairings.current?.key)
        deliverSoon()
        return queued
    }

    /** A failed capture goes back to pending, and a delivery run starts; a pending one is just tried again. */
    fun retry(id: String) {
        queue.update(id) { if (it.status == Status.Failed) it.copy(status = Status.Pending, reason = null) else it }
        deliverSoon()
    }

    fun discard(id: String) = queue.discard(id)

    private fun storeView(p: Pairing, current: Boolean) =
        StoreView(
            key = p.key,
            name = p.name,
            url = p.url,
            current = current,
            status = statusLine(p),
            ok = p.paused == null && CAPTURE_CONTRACT in p.accepts,
        )

    private fun entryView(item: QueuedCapture, stores: List<Pairing>): EntryView {
        val c = item.capture
        val s = item.state
        return EntryView(
            id = c.captureId,
            summary = c.summary(),
            store = s.store?.let { key -> stores.firstOrNull { it.key == key }?.name ?: key } ?: "not paired",
            capturedAt = c.capturedAt,
            status = s.status.name.lowercase(),
            reason = s.reason,
            nodeId = s.receipt?.nodeId,
            files = c.files.size,
            source = c.source?.app,
            attempts = s.attempts,
        )
    }

    companion object {
        /** Whether a store takes this phone's captures, in a line. */
        fun statusLine(p: Pairing): String =
            when {
                p.paused != null -> "Paused: ${p.paused}. Pair again."
                p.accepts.isEmpty() -> "Capture contract not confirmed yet (this phone sends v$CAPTURE_CONTRACT)."
                CAPTURE_CONTRACT in p.accepts -> "Accepts v$CAPTURE_CONTRACT · in step with this phone"
                else -> Deliverer.versionReason(p.name, p.accepts, CAPTURE_CONTRACT) + " Shares stay queued."
            }
    }
}
