package app.kb.capture.shell

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebView

/**
 * The WebView a paired store's own kb UI runs in: a plain WebView that no
 * bridge ever touches, so the store's page has a browser's powers and
 * nothing more. Capacitor's bridge lives only in the other WebView, which
 * shows the shell's bundled page ([Routes.SHELL]). It reaches its page
 * through a document-start script scoped to that origin, and where the
 * scoped listener is unavailable it falls back to an origin-wide
 * `addJavascriptInterface`. A store's page in that WebView would then reach
 * the queue and the pairings. Here it never can: this WebView refuses any
 * JavaScript interface, whoever asks.
 */
@SuppressLint("SetJavaScriptEnabled")
class StoreWebView(context: Context) : WebView(context) {
    init {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
    }

    override fun addJavascriptInterface(obj: Any, name: String): Unit =
        throw UnsupportedOperationException("a store's page gets no native interface ($name)")
}
