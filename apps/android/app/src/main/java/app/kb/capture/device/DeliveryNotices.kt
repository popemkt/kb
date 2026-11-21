package app.kb.capture.device

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.kb.capture.R
import app.kb.capture.delivery.Notices
import app.kb.capture.pairing.Pairing
import app.kb.capture.queue.QueuedCapture
import app.kb.capture.shell.ShellActivity

/**
 * [Notices] as local notifications, on one channel; a tap opens the queue
 * (`kb://queue`), where the capture can be retried or discarded and a
 * paused store paired again. Posted only when the person allowed
 * notifications; the queue says the same either way.
 */
class DeliveryNotices(private val context: Context) : Notices {
    override fun refused(entry: QueuedCapture, store: Pairing, reason: String) =
        post(entry.capture.captureId.hashCode(), "${store.name} refused a capture", "${entry.capture.summary()} — $reason")

    override fun paused(store: Pairing, reason: String) =
        post(store.key.hashCode(), "${store.name} stopped accepting this phone", "Captures wait until you pair it again. $reason")

    private fun post(id: Int, title: String, text: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val manager = NotificationManagerCompat.from(context)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.channel_delivery), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = context.getString(R.string.channel_delivery_description)
            },
        )
        val open =
            PendingIntent.getActivity(
                context,
                0,
                Intent(Intent.ACTION_VIEW, Uri.parse("kb://queue"), context, ShellActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        val notification =
            NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_capture)
                .setColor(ContextCompat.getColor(context, R.color.kb_primary))
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
        try {
            manager.notify(id, notification)
        } catch (_: SecurityException) {
            // Permission withdrawn between the check and the post: the queue still shows it.
        }
    }

    private companion object {
        const val CHANNEL = "delivery"
    }
}
