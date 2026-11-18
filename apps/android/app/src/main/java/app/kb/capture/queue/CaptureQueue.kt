package app.kb.capture.queue

import app.kb.capture.capture.CAPTURE_CONTRACT
import app.kb.capture.capture.CaptureDraft
import app.kb.capture.capture.CaptureSource
import app.kb.capture.capture.PayloadWriter
import app.kb.capture.capture.RawCapture
import app.kb.capture.capture.StagedFile
import app.kb.capture.capture.isoWithOffset
import app.kb.capture.storage.Disk
import app.kb.capture.storage.Durable
import app.kb.capture.storage.RealDisk
import java.io.File
import java.io.InputStream
import java.time.OffsetDateTime
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable

/** Where a queued capture stands. */
@Serializable
enum class Status {
    /** Waiting to be delivered; [DeliveryState.reason] says why it has not been yet, when it has tried. */
    Pending,

    /** The host committed it; [DeliveryState.receipt] names the node. Its file bytes are released. */
    Sent,

    /** The host refused it for good; [DeliveryState.reason] says why. Retry moves it back to pending. */
    Failed,
}

/** The host's committed receipt for a capture (`capture.submit`'s output). */
@Serializable
data class Receipt(val nodeId: String, val store: String? = null)

/**
 * The mutable half of a queue entry. [store] is the pairing the capture is
 * pinned to: set when it is queued (or, if nothing was paired yet, at the
 * first pairing), and never changed by choosing another default store.
 */
@Serializable
data class DeliveryState(
    val status: Status = Status.Pending,
    val store: String? = null,
    val attempts: Int = 0,
    val reason: String? = null,
    val receipt: Receipt? = null,
    val updatedAt: String,
)

/** One entry as the app shows it: the raw capture and where its delivery stands. */
data class QueuedCapture(val capture: RawCapture, val state: DeliveryState)

/**
 * The phone's durable capture queue: one directory per capture under
 * `entries/`, holding the immutable `capture.json`, the copied file bytes
 * under `files/`, and the mutable `state.json`.
 *
 * Durability is [Durable]'s. A capture is assembled in `staging/` and
 * published into `entries/` by one durable rename before the share is
 * acknowledged; a state change durably replaces `state.json`; a discard is
 * durably moved into `trash/` before it is deleted; and a Sent capture's
 * bytes are released only after Sent is durable. A crash therefore leaves
 * either the whole entry or none of it, never a pending capture without its
 * bytes, and [recover] finishes what a crash interrupted.
 *
 * off-graph: device-local — shares wait here until the paired store commits
 * them; the store is the truth, and an entry is released once its receipt
 * arrives. One process owns the directory, and every mutation holds the
 * queue's lock.
 */
class CaptureQueue(
    private val root: File,
    private val disk: Disk = RealDisk(),
    private val now: () -> OffsetDateTime = OffsetDateTime::now,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    private val entries = File(root, "entries")
    private val staging = File(root, "staging")
    private val trash = File(root, "trash")
    private val lock = Any()
    private val _items = MutableStateFlow<List<QueuedCapture>>(emptyList())

    /** Every entry, newest first, re-read after each change. */
    val items: StateFlow<List<QueuedCapture>> = _items.asStateFlow()

    init {
        recover()
    }

    /** Clears what a crash left half-done: unpublished staging and half-removed entries. */
    fun recover() =
        synchronized(lock) {
            listOf(entries, staging, trash).forEach { Durable.ensureDir(disk, it) }
            disk.list(staging).forEach { disk.delete(File(staging, it)) }
            disk.list(trash).forEach { disk.delete(File(trash, it)) }
            disk.list(entries).forEach { id ->
                val dir = File(entries, id)
                disk.list(dir).filter { it.endsWith(".tmp") }.forEach { disk.delete(File(dir, it)) }
                // A crash between a durable Sent and the release of its bytes leaves them; finish the release.
                if (read(dir)?.state?.status == Status.Sent) disk.delete(File(dir, FILES))
            }
            refresh()
        }

    /**
     * Copies the draft's files, writes the raw capture and publishes it in
     * one rename. Throws (and leaves nothing behind) when a file cannot be
     * read or the disk is full; the receiver shows that while it is open.
     */
    fun enqueue(draft: CaptureDraft, store: String?): QueuedCapture {
        val d = draft.normalized()
        require(!d.isEmpty) { "Nothing to capture" }
        val id = newId()
        val at = now()
        val dir = File(staging, id)
        try {
            val filesDir = File(dir, FILES).also { disk.mkdirs(it) }
            val staged =
                d.files.mapIndexed { index, source ->
                    val size = source.open().use { input -> disk.create(File(filesDir, index.toString())) { input.copyTo(it) } }
                    StagedFile(name = source.name, mime = source.mime, path = "$FILES/$index", size = size)
                }
            val capture =
                RawCapture(
                    version = CAPTURE_CONTRACT,
                    captureId = id,
                    capturedAt = isoWithOffset(at),
                    source = d.sourceApp?.let { CaptureSource(app = it) },
                    text = d.text,
                    url = d.url,
                    title = d.title,
                    files = staged,
                )
            val state = DeliveryState(store = store, updatedAt = isoWithOffset(at))
            disk.create(File(dir, CAPTURE)) { it.write(encode(RawCapture.serializer(), capture)) }
            disk.create(File(dir, STATE)) { it.write(encode(DeliveryState.serializer(), state)) }
            synchronized(lock) {
                Durable.rename(disk, dir, File(entries, id))
                refresh()
            }
            return QueuedCapture(capture, state)
        } catch (e: Throwable) {
            runCatching { disk.delete(dir) }
            throw e
        }
    }

    fun get(id: String): QueuedCapture? = read(File(entries, id))

    /** Rewrites one entry's state atomically; returns the new state, or null when the entry is gone. */
    fun update(id: String, change: (DeliveryState) -> DeliveryState): DeliveryState? =
        synchronized(lock) {
            val dir = File(entries, id)
            val current = read(dir) ?: return null
            val next = change(current.state).copy(updatedAt = isoWithOffset(now()))
            Durable.replace(disk, File(dir, STATE)) { it.write(encode(DeliveryState.serializer(), next)) }
            // Released only once Sent is durable: a crash can never leave a pending capture without its bytes.
            if (next.status == Status.Sent) disk.delete(File(dir, FILES))
            refresh()
            next
        }

    /** Marks the capture sent and releases its copied bytes; the receipt stays. */
    fun markSent(id: String, receipt: Receipt) =
        update(id) { it.copy(status = Status.Sent, receipt = receipt, reason = null) }

    /** Removes an entry: renamed into `trash/` first, so a crash mid-delete never leaves a half entry in the list. */
    fun discard(id: String) =
        synchronized(lock) {
            val dir = File(entries, id)
            val gone = File(trash, id)
            if (id in disk.list(entries)) {
                Durable.rename(disk, dir, gone)
                disk.delete(gone)
            }
            refresh()
        }

    /** Pins every unpinned pending capture to [store]: the first pairing adopts what was queued before it. */
    fun pinUnpinned(store: String) =
        all().filter { it.state.store == null && it.state.status == Status.Pending }.forEach { entry ->
            update(entry.capture.captureId) { it.copy(store = store) }
        }

    fun openFile(id: String, file: StagedFile): InputStream = disk.open(File(File(entries, id), file.path))

    fun all(): List<QueuedCapture> =
        disk.list(entries).mapNotNull { read(File(entries, it)) }.sortedByDescending { it.capture.capturedAt }

    private fun refresh() {
        _items.value = all()
    }

    private fun read(dir: File): QueuedCapture? =
        try {
            QueuedCapture(
                PayloadWriter.json.decodeFromString(RawCapture.serializer(), disk.read(File(dir, CAPTURE)).decodeToString()),
                PayloadWriter.json.decodeFromString(DeliveryState.serializer(), disk.read(File(dir, STATE)).decodeToString()),
            )
        } catch (_: Exception) {
            null
        }

    private fun <T> encode(serializer: KSerializer<T>, value: T): ByteArray = PayloadWriter.json.encodeToString(serializer, value).toByteArray()

    private companion object {
        const val CAPTURE = "capture.json"
        const val STATE = "state.json"
        const val FILES = "files"
    }
}
