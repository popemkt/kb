package app.kb.capture.capture

import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import kotlinx.serialization.Serializable

/**
 * The capture contract version this app encodes a share in. The host
 * advertises the versions it accepts as `kb.manifest`'s `captureContract`;
 * each queued capture keeps the version it was encoded in, so a host update
 * between queueing and delivery is seen rather than guessed.
 */
const val CAPTURE_CONTRACT = 1

/** A capture's timestamp: ISO 8601 to the millisecond, with the phone's UTC offset at that moment. */
fun isoWithOffset(t: OffsetDateTime): String = t.format(ISO_WITH_OFFSET)

private val ISO_WITH_OFFSET = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX")

/** The host action every capture is delivered to. */
const val CAPTURE_SUBMIT = "capture.submit"

/** Where the share came from, when the OS says. Absent fields stay absent. */
@Serializable
data class CaptureSource(val app: String? = null)

/** Where the capture should go. The host owns placement; a null parent leaves it to the store's capture target. */
@Serializable
data class CaptureTarget(val store: String? = null, val parent: String? = null)

/**
 * One shared file, copied into the queue entry while the share's read grant
 * was valid. [path] is relative to the entry; the bytes are base64-encoded
 * only when the capture is written to the wire ([PayloadWriter]).
 */
@Serializable
data class StagedFile(val name: String, val mime: String, val path: String, val size: Long)

/**
 * The raw share as the person made it: text, URL and title exactly as the
 * source app supplied them, files in their order, and the moment of capture
 * with its UTC offset. The phone maps nothing; parent, fields and assets are
 * the host's (`capture.submit`). Immutable once queued.
 */
@Serializable
data class RawCapture(
    val version: Int = CAPTURE_CONTRACT,
    val captureId: String,
    val capturedAt: String,
    val source: CaptureSource? = null,
    val text: String? = null,
    val url: String? = null,
    val title: String? = null,
    val files: List<StagedFile> = emptyList(),
    val target: CaptureTarget? = null,
) {
    /** A short line for the app's list: the title, else the text, else the URL, else the file names. */
    fun summary(): String =
        title?.takeIf { it.isNotBlank() }
            ?: text?.lineSequence()?.firstOrNull { it.isNotBlank() }
            ?: url
            ?: files.joinToString(", ") { it.name }.ifEmpty { "(empty)" }
}

/** A file offered by a share, before it is copied: its bytes are read once, by [open]. */
class FileSource(val name: String, val mime: String, val open: () -> java.io.InputStream)

/** What a share or the manual field offers, before it is queued. */
data class CaptureDraft(
    val text: String? = null,
    val url: String? = null,
    val title: String? = null,
    val sourceApp: String? = null,
    val files: List<FileSource> = emptyList(),
) {
    /** Empty strings are absent, not values: a share with nothing in it is refused at the receiver. */
    fun normalized(): CaptureDraft =
        copy(
            text = text?.takeIf { it.isNotEmpty() },
            url = url?.takeIf { it.isNotEmpty() },
            title = title?.takeIf { it.isNotEmpty() },
            sourceApp = sourceApp?.takeIf { it.isNotEmpty() },
        )

    val isEmpty: Boolean
        get() = normalized().let { it.text == null && it.url == null && it.files.isEmpty() }
}
