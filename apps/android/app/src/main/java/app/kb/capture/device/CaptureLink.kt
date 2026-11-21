package app.kb.capture.device

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import app.kb.capture.shell.ShellActivity

/**
 * The one way an OS surface (the home-screen widget, the quick-settings
 * tile) opens a capture: the `kb://capture` link, which the shell opens as
 * any `kb://` link ([app.kb.capture.shell.Routes.forLink]).
 */
object CaptureLink {
    const val URI = "kb://capture"

    fun intent(context: Context): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse(URI), context, ShellActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

    fun pending(context: Context): PendingIntent =
        PendingIntent.getActivity(context, 0, intent(context), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
}
