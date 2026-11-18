package app.kb.capture

import app.kb.capture.storage.Disk
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/** The power went out. */
class Crash : RuntimeException("simulated power loss")

/**
 * An in-memory [Disk] that models what a power cut keeps, the way POSIX
 * filesystems promise it:
 *
 * - a file's contents last once they are synced ([create] syncs them);
 * - a directory's names (created, renamed, removed) last only once that
 *   directory is synced ([syncDir]), however well the files were synced.
 *
 * [crashAt] cuts the power before the n-th mutating step, and every step after
 * it fails too. [crashImages] then gives the disks a reboot may find: nothing
 * unsynced kept, everything kept, and each directory with unsynced names kept
 * on its own (the kernel may flush any directory at any moment), so a test
 * sees the orders a real crash could produce, not one lucky order.
 */
class CrashDisk private constructor(private val nodes: MutableMap<Int, Node>, private var nextId: Int) : Disk {
    private sealed interface Node

    private class FileNode(var live: ByteArray, var durable: ByteArray?) : Node

    private class DirNode(val live: MutableMap<String, Int>, var durable: Map<String, Int>) : Node

    constructor() : this(mutableMapOf(ROOT to DirNode(mutableMapOf(), emptyMap())), ROOT + 1)

    var steps = 0
        private set
    var crashAt = Int.MAX_VALUE
    private var crashed = false

    private fun step() {
        if (crashed || steps >= crashAt) {
            crashed = true
            throw Crash()
        }
        steps++
    }

    private fun parts(f: File) = f.path.split('/').filter { it.isNotEmpty() }

    private fun resolve(f: File): Int? {
        var id = ROOT
        for (part in parts(f)) id = (nodes[id] as? DirNode)?.live?.get(part) ?: return null
        return id
    }

    private fun dirAt(f: File): DirNode = resolve(f)?.let { nodes[it] as? DirNode } ?: throw IOException("no directory $f")

    override fun isFile(f: File) = resolve(f)?.let { nodes[it] is FileNode } ?: false

    override fun isDirectory(f: File) = resolve(f)?.let { nodes[it] is DirNode } ?: false

    override fun list(dir: File): List<String> = (resolve(dir)?.let { nodes[it] as? DirNode })?.live?.keys?.sorted() ?: emptyList()

    override fun read(f: File): ByteArray = (resolve(f)?.let { nodes[it] as? FileNode } ?: throw FileNotFoundException(f.path)).live.copyOf()

    override fun open(f: File): InputStream = read(f).inputStream()

    override fun mkdirs(dir: File) {
        step()
        var id = ROOT
        for (part in parts(dir)) {
            val parent = nodes[id] as? DirNode ?: throw IOException("not a directory under $dir")
            id = parent.live.getOrPut(part) { nextId++.also { nodes[it] = DirNode(mutableMapOf(), emptyMap()) } }
        }
    }

    override fun create(f: File, body: (OutputStream) -> Unit): Long {
        step()
        val parent = dirAt(f.parentFile!!)
        val node = FileNode(ByteArray(0), null)
        parent.live[f.name] = nextId.also { nodes[it] = node }
        nextId++
        val out = ByteArrayOutputStream()
        try {
            body(out)
        } finally {
            node.live = out.toByteArray()
        }
        node.durable = node.live.copyOf()
        return node.live.size.toLong()
    }

    override fun rename(from: File, to: File) {
        step()
        val src = dirAt(from.parentFile!!)
        val id = src.live.remove(from.name) ?: throw IOException("no $from")
        dirAt(to.parentFile!!).live[to.name] = id
    }

    override fun syncDir(dir: File) {
        step()
        val d = dirAt(dir)
        d.durable = d.live.toMap()
    }

    override fun delete(f: File) {
        val id = resolve(f) ?: return
        (nodes[id] as? DirNode)?.let { d -> d.live.keys.sorted().forEach { delete(File(f, it)) } }
        step()
        dirAt(f.parentFile!!).live.remove(f.name)
    }

    /** A copy with the same live and durable state, for running the same operation again. */
    fun fork(): CrashDisk = image { _, node -> node }.also { it.steps = steps }

    /** The disks a reboot after a crash right now may find. */
    fun crashImages(): List<CrashDisk> {
        val dirty = nodes.filter { (_, n) -> n is DirNode && n.live != n.durable }.keys
        return listOf(reboot(emptySet(), files = false), reboot(dirty, files = true)) + dirty.map { reboot(setOf(it), files = false) }
    }

    private fun reboot(flushed: Set<Int>, files: Boolean): CrashDisk {
        return image { id, node ->
            when (node) {
                is DirNode -> {
                    val kept = if (id in flushed) node.live.toMap() else node.durable
                    DirNode(kept.toMutableMap(), kept)
                }
                is FileNode -> {
                    val kept = if (files) node.live else node.durable ?: ByteArray(0)
                    FileNode(kept.copyOf(), kept.copyOf())
                }
            }
        }
    }

    private fun image(map: (Int, Node) -> Node): CrashDisk {
        val copy =
            nodes.mapValuesTo(mutableMapOf()) { (id, n) ->
                when (val m = map(id, n)) {
                    is DirNode -> DirNode(m.live.toMutableMap(), m.durable.toMap())
                    is FileNode -> FileNode(m.live.copyOf(), m.durable?.copyOf())
                }
            }
        return CrashDisk(copy, nextId)
    }

    companion object {
        private const val ROOT = 0
    }
}
