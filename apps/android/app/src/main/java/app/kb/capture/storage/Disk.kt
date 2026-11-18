package app.kb.capture.storage

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.channels.FileChannel
import java.nio.file.StandardOpenOption

/**
 * The file operations the app's device-local state is kept with: the capture
 * queue and the pairings. Both go through this one port, and make anything
 * durable only through [Durable], so what a crash can leave behind is decided
 * in one place and is tested against a disk that crashes on purpose.
 */
interface Disk {
    fun isFile(f: File): Boolean

    fun isDirectory(f: File): Boolean

    /** The names in [dir]; empty when it is not a directory. */
    fun list(dir: File): List<String>

    fun read(f: File): ByteArray

    fun open(f: File): InputStream

    fun mkdirs(dir: File)

    /** Writes a new file from [body] and syncs its contents; returns its size. */
    fun create(f: File, body: (OutputStream) -> Unit): Long

    /** Renames atomically, replacing [to] if it exists. */
    fun rename(from: File, to: File)

    /**
     * Syncs a directory's entries: until this returns, a name created,
     * renamed or removed in [dir] may be lost or undone by a power cut,
     * however well the file's own contents were synced.
     */
    fun syncDir(dir: File)

    /** Removes a file or a directory tree; a missing path is not an error. */
    fun delete(f: File)
}

/**
 * [Disk] on the real filesystem. Syncing a directory needs a descriptor for
 * it, which `java.io` cannot open; [syncDirectory] does it. On the JVM that is
 * [forceDirectory], and on the phone `android.system.Os` (`KbCapture`).
 */
class RealDisk(private val syncDirectory: (File) -> Unit = ::forceDirectory) : Disk {
    override fun isFile(f: File) = f.isFile

    override fun isDirectory(f: File) = f.isDirectory

    override fun list(dir: File): List<String> = dir.list()?.toList() ?: emptyList()

    override fun read(f: File): ByteArray = f.readBytes()

    override fun open(f: File): InputStream = f.inputStream()

    override fun mkdirs(dir: File) {
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) throw IOException("could not create $dir")
    }

    override fun create(f: File, body: (OutputStream) -> Unit): Long =
        FileOutputStream(f).use { out ->
            body(out)
            out.flush()
            out.fd.sync()
            out.channel.size()
        }

    override fun rename(from: File, to: File) {
        if (!from.renameTo(to)) throw IOException("could not rename $from to $to")
    }

    override fun syncDir(dir: File) = syncDirectory(dir)

    override fun delete(f: File) {
        f.deleteRecursively()
    }
}

/** Syncs a directory through a read-only channel on it: `fsync(2)` on the directory, on the JVM. */
fun forceDirectory(dir: File) = FileChannel.open(dir.toPath(), StandardOpenOption.READ).use { it.force(true) }
