package app.kb.capture.share

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.content.IntentCompat
import androidx.lifecycle.lifecycleScope
import app.kb.capture.KbCapture
import app.kb.capture.capture.CaptureDraft
import app.kb.capture.capture.FileSource
import app.kb.capture.delivery.DeliveryWorker
import java.io.FileNotFoundException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The share-sheet target. It draws nothing: it reads the share, copies its
 * bytes into the queue while the sender's read grant is still valid, says
 * "Queued · <store>" and finishes, so the person is back in the source app
 * at once. Delivery happens later, in [DeliveryWorker].
 *
 * Only exercised by hand on a device so far. GAP [[01M7QTAJ9GSK02FMWNR4XQGFMT]]
 */
class ShareActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = KbCapture.of(this)
        val draft = readShare(intent, contentResolver, referrer?.takeIf { it.scheme == "android-app" }?.host)
        val store = app.pairings.current
        lifecycleScope.launch {
            val queued = withContext(Dispatchers.IO) { runCatching { app.queue.enqueue(draft, store?.key) } }
            val message =
                queued.fold(
                    onSuccess = { "Queued · ${store?.name ?: "not paired yet"}" },
                    onFailure = { "Not queued: ${it.message ?: it.javaClass.simpleName}" },
                )
            Toast.makeText(applicationContext, message, if (queued.isSuccess) Toast.LENGTH_SHORT else Toast.LENGTH_LONG).show()
            if (queued.isSuccess) DeliveryWorker.schedule(applicationContext)
            finish()
        }
    }

    companion object {
        /**
         * The share as the sender supplied it: `EXTRA_TEXT` verbatim as text
         * (a sole URL included; the host recognises it), `EXTRA_SUBJECT` as
         * title, and every stream in order. Nothing is read from a stream
         * here; [FileSource.open] does that once, in the queue.
         */
        fun readShare(intent: Intent, resolver: ContentResolver, sourceApp: String?): CaptureDraft {
            val streams =
                when (intent.action) {
                    Intent.ACTION_SEND_MULTIPLE ->
                        IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
                    else -> listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
                }.ifEmpty { clipUris(intent) }
            val files =
                streams.mapIndexed { index, uri ->
                    FileSource(
                        name = displayName(resolver, uri) ?: uri.lastPathSegment ?: "shared-$index",
                        mime = resolver.getType(uri) ?: intent.type?.takeUnless { it.endsWith("/*") } ?: "application/octet-stream",
                        open = { resolver.openInputStream(uri) ?: throw FileNotFoundException("cannot read $uri") },
                    )
                }
            return CaptureDraft(
                text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
                title = intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: intent.getStringExtra(Intent.EXTRA_TITLE),
                sourceApp = sourceApp,
                files = files,
            )
        }

        private fun clipUris(intent: Intent): List<Uri> {
            val clip = intent.clipData ?: return emptyList()
            return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
        }

        private fun displayName(resolver: ContentResolver, uri: Uri): String? =
            try {
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                    if (c.moveToFirst()) c.getString(0) else null
                }
            } catch (_: Exception) {
                null
            }
    }
}
