package app.kb.capture.device

import android.annotation.SuppressLint
import android.os.Build
import android.service.quicksettings.TileService

/** The quick-settings tile: one tap collapses the shade and opens Capture ([CaptureLink]). */
class CaptureTile : TileService() {
    @SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        super.onClick()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(CaptureLink.pending(this))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(CaptureLink.intent(this))
        }
    }
}
