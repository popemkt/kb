package app.kb.capture.storage

import android.system.Os
import android.system.OsConstants
import java.io.File

/** Syncs a directory's entries on Android: `open(2)` it read-only and `fsync(2)` the descriptor (API 21+). */
fun fsyncDirectory(dir: File) {
    val fd = Os.open(dir.path, OsConstants.O_RDONLY, 0)
    try {
        Os.fsync(fd)
    } finally {
        Os.close(fd)
    }
}
