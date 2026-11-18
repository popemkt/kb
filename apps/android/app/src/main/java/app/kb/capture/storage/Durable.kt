package app.kb.capture.storage

import java.io.File
import java.io.OutputStream

/**
 * The one way device-local state is made to survive a power cut. A write is
 * acknowledged (the share's toast, a state change, a saved pairing) only
 * after one of these returns.
 *
 * [Disk.create] syncs a file's contents, but a name only lasts once its
 * directory is synced. So a write is built under a name nobody reads, its
 * directory tree synced, renamed into place, and the directories on both
 * sides of the rename synced.
 */
object Durable {
    /**
     * Renames [from] to [to] so that, once this returns, a crash leaves [to]
     * with everything [from] held. When [from] is a directory built in place,
     * its tree is synced first, so the rename never publishes names that a
     * crash could still take back.
     */
    fun rename(disk: Disk, from: File, to: File) {
        if (disk.isDirectory(from)) syncTree(disk, from)
        disk.rename(from, to)
        disk.syncDir(to.parentFile!!)
        if (from.parentFile != to.parentFile) disk.syncDir(from.parentFile!!)
    }

    /** Replaces [target]'s contents with [body]'s whole, or leaves the old ones: written beside it, then [rename]d over it. */
    fun replace(disk: Disk, target: File, body: (OutputStream) -> Unit) {
        val tmp = File(target.path + ".tmp")
        disk.create(tmp, body)
        rename(disk, tmp, target)
    }

    /** Creates [dir] and any missing ancestors, each recorded in its parent before this returns. */
    fun ensureDir(disk: Disk, dir: File) {
        val missing = generateSequence(dir) { it.parentFile }.takeWhile { !disk.isDirectory(it) }.toList()
        if (missing.isEmpty()) return
        disk.mkdirs(dir)
        missing.asReversed().forEach { disk.syncDir(it.parentFile!!) }
    }

    private fun syncTree(disk: Disk, dir: File) {
        disk.list(dir).map { File(dir, it) }.filter { disk.isDirectory(it) }.forEach { syncTree(disk, it) }
        disk.syncDir(dir)
    }
}
