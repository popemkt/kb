package app.kb.capture.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.kb.capture.KbCapture
import app.kb.capture.delivery.DeliveryWorker

/** The containing app: pairing, the delivery list and a manual capture field. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { KbTheme { CaptureScreen(KbCapture.of(this)) } }
    }

    /** Opening the app is a reason to try again: a capture waiting on a sleeping host goes out now. */
    override fun onResume() {
        super.onResume()
        DeliveryWorker.schedule(this)
    }
}
