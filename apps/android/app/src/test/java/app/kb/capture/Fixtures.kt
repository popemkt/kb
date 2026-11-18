package app.kb.capture

import app.kb.capture.capture.CaptureDraft
import app.kb.capture.capture.FileSource
import app.kb.capture.pairing.Pairings
import app.kb.capture.pairing.TokenVault
import app.kb.capture.queue.CaptureQueue
import java.io.File
import java.nio.file.Files
import java.time.OffsetDateTime
import java.time.ZoneOffset

/** A clock that ticks one second per reading, from a fixed instant with a +07:00 offset. */
class TickingClock {
    private var t = OffsetDateTime.of(2026, 11, 19, 8, 30, 0, 0, ZoneOffset.ofHours(7))

    fun now(): OffsetDateTime = t.also { t = t.plusSeconds(1) }
}

/** Seals nothing: the JVM has no Android Keystore. Tags the token so a test sees it went through the vault. */
object PlainVault : TokenVault {
    override fun seal(token: String) = "sealed:$token"

    override fun open(sealed: String) = sealed.removePrefix("sealed:")
}

fun tempDir(): File = Files.createTempDirectory("kb-capture-test").toFile()

fun newQueue(root: File, clock: TickingClock = TickingClock()): CaptureQueue {
    var n = 0
    return CaptureQueue(root, now = clock::now, newId = { "cap-${++n}-${root.name}" })
}

fun newPairings(root: File) = Pairings(File(root, "pairings.json"), PlainVault)

fun bytesFile(name: String, mime: String, bytes: ByteArray) = FileSource(name, mime) { bytes.inputStream() }

/** The mixed fixture every adapter is driven with: text, a URL, a title and two files in order. */
val PNG = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d) + ByteArray(300) { (it * 7).toByte() }
val JPG = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte()) + ByteArray(1000) { (it % 251).toByte() }

fun mixedDraft() =
    CaptureDraft(
        text = "Line one\nLine two · ünïcödé 🌱\n",
        url = "https://example.com/a?b=c&d=e",
        title = "Example \"quoted\" title",
        sourceApp = "com.android.chrome",
        files = listOf(bytesFile("first.png", "image/png", PNG), bytesFile("second.jpg", "image/jpeg", JPG)),
    )
