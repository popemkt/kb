package app.kb.capture.delivery

import app.kb.capture.pairing.Pairing
import app.kb.capture.queue.QueuedCapture

/**
 * What delivery tells the person when no page is open to show it: a capture
 * the host refused for good, and a store that stopped accepting this phone.
 * Each is said once, when it happens; the queue keeps the state.
 */
interface Notices {
    fun refused(entry: QueuedCapture, store: Pairing, reason: String)

    fun paused(store: Pairing, reason: String)

    /** Says nothing: tests, and a run with no one to tell. */
    object None : Notices {
        override fun refused(entry: QueuedCapture, store: Pairing, reason: String) = Unit

        override fun paused(store: Pairing, reason: String) = Unit
    }
}
