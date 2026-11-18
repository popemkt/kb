package app.kb.capture.storage

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * The file operations the app's device-local state is kept with: the capture
 * queue and the pairings. Both go through this one port, so what a crash can
 * leave behind is decided in one place and can be tested against a disk that
 * crashes on purpose.
 */
interface Disk {
    fun isFile(f: File): Boolean

    /** The names in [dir]; empty when it is not a directory. */
    fun list(dir: File): List<String>

    fun read(f: File): ByteArray

    fun open(f: File): InputStream

    fun mkdirs(dir: File)

    /** Writes a new file from [body] and syncs its contents; returns its size. */
    fun create(f: File, body: (OutputStream) -> Unit): Long

    /** Renames atomically, replacing [to] if it exists. */
    fun rename(from: File, to: File)

    /** Removes a file or a directory tree; a missing path is not an error. */
    fun delete(f: File)
}

/** [Disk] on the device's real filesystem. */
class RealDisk : Disk {
    override fun isFile(f: File) = f.isFile

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

    override fun delete(f: File) {
        f.deleteRecursively()
    }
}
