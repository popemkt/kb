package app.kb.capture.queue

import app.kb.capture.capture.CAPTURE_CONTRACT
import app.kb.capture.capture.CaptureDraft
import app.kb.capture.capture.CaptureSource
import app.kb.capture.capture.PayloadWriter
import app.kb.capture.capture.RawCapture
import app.kb.capture.capture.StagedFile
import app.kb.capture.capture.isoWithOffset
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.time.OffsetDateTime
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
 * Durability is by atomic rename. A capture is assembled in `staging/` (bytes
 * copied, metadata written, all fsynced) and published by renaming its
 * directory into `entries/`; a state change writes a temporary file and
 * renames it over `state.json`. A crash therefore leaves either the whole
 * entry or none of it, and [recover] clears what a crash left in `staging/`
 * and `trash/`.
 *
 * off-graph: device-local — shares wait here until the paired store commits
 * them; the store is the truth, and an entry is released once its receipt
 * arrives. One process owns the directory, and every mutation holds the
 * queue's lock.
 */
class CaptureQueue(
    private val root: File,
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
            listOf(entries, staging, trash).forEach { it.mkdirs() }
            staging.listFiles()?.forEach { it.deleteRecursively() }
            trash.listFiles()?.forEach { it.deleteRecursively() }
            entries.listFiles()?.forEach { dir ->
                dir.listFiles { f -> f.name.endsWith(".tmp") }?.forEach { it.delete() }
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
            val filesDir = File(dir, FILES).apply { mkdirs() }
            val staged =
                d.files.mapIndexed { index, source ->
                    val target = File(filesDir, index.toString())
                    val size = source.open().use { input -> writeSynced(target) { input.copyTo(it) } }
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
            writeSynced(File(dir, CAPTURE)) { it.write(PayloadWriter.json.encodeToString(RawCapture.serializer(), capture).toByteArray()) }
            writeSynced(File(dir, STATE)) { it.write(PayloadWriter.json.encodeToString(DeliveryState.serializer(), state).toByteArray()) }
            synchronized(lock) {
                if (!dir.renameTo(File(entries, id))) throw IOException("could not publish capture $id")
                refresh()
            }
            return QueuedCapture(capture, state)
        } catch (e: Throwable) {
            dir.deleteRecursively()
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
            writeState(dir, next)
            if (next.status == Status.Sent) File(dir, FILES).deleteRecursively()
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
            if (dir.exists() && dir.renameTo(gone)) gone.deleteRecursively()
            refresh()
        }

    /** Pins every unpinned pending capture to [store]: the first pairing adopts what was queued before it. */
    fun pinUnpinned(store: String) =
        all().filter { it.state.store == null && it.state.status == Status.Pending }.forEach { entry ->
            update(entry.capture.captureId) { it.copy(store = store) }
        }

    fun openFile(id: String, file: StagedFile): InputStream = File(File(entries, id), file.path).inputStream()

    fun all(): List<QueuedCapture> =
        (entries.listFiles()?.mapNotNull { read(it) } ?: emptyList()).sortedByDescending { it.capture.capturedAt }

    private fun refresh() {
        _items.value = all()
    }

    private fun read(dir: File): QueuedCapture? {
        val capture = File(dir, CAPTURE).takeIf { it.isFile } ?: return null
        val state = File(dir, STATE).takeIf { it.isFile } ?: return null
        return try {
            QueuedCapture(
                PayloadWriter.json.decodeFromString(RawCapture.serializer(), capture.readText()),
                PayloadWriter.json.decodeFromString(DeliveryState.serializer(), state.readText()),
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun writeState(dir: File, state: DeliveryState) {
        val tmp = File(dir, "$STATE.tmp")
        writeSynced(tmp) { it.write(PayloadWriter.json.encodeToString(DeliveryState.serializer(), state).toByteArray()) }
        if (!tmp.renameTo(File(dir, STATE))) throw IOException("could not update ${dir.name}")
    }

    private fun writeSynced(file: File, body: (FileOutputStream) -> Unit): Long =
        FileOutputStream(file).use { out ->
            body(out)
            out.flush()
            out.fd.sync()
            out.channel.size()
        }

    private companion object {
        const val CAPTURE = "capture.json"
        const val STATE = "state.json"
        const val FILES = "files"
    }
}
