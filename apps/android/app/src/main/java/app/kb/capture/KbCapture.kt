package app.kb.capture

import android.app.Application
import android.content.Context
import app.kb.capture.delivery.Deliverer
import app.kb.capture.delivery.HttpCaptureHost
import app.kb.capture.delivery.Pairer
import app.kb.capture.pairing.KeystoreVault
import app.kb.capture.pairing.Pairings
import app.kb.capture.queue.CaptureQueue
import java.io.File

/**
 * The app's one composition root: the queue, the pairings and the host
 * client every screen, receiver and worker share in this process. It
 * schedules no delivery itself: WorkManager starts this process to run the
 * worker, and a schedule here would replace the very run it started.
 */
class KbCapture : Application() {
    val queue by lazy { CaptureQueue(File(filesDir, "capture-queue")) }
    val pairings by lazy { Pairings(File(filesDir, "pairings.json"), KeystoreVault()) }
    private val host by lazy { HttpCaptureHost() }
    val deliverer by lazy { Deliverer(queue, pairings, host) }
    val pairer by lazy { Pairer(queue, pairings, host) }

    companion object {
        fun of(context: Context): KbCapture = context.applicationContext as KbCapture
    }
}
