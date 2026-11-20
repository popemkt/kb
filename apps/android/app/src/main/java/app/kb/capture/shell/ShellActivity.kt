package app.kb.capture.shell

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import app.kb.capture.KbCapture
import app.kb.capture.R
import app.kb.capture.delivery.DeliveryWorker
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeActivity
import com.getcapacitor.BridgeWebViewClient

/**
 * The app: one WebView, which shows either the shell's own page (Stores,
 * the queue, Capture) or a paired store's own kb UI, loaded from the store
 * as a browser would load it ([Routes]). It owns the three things the page
 * cannot: what a launch or a `kb://` link opens, the back button, and the
 * queue in place of a store UI that did not load.
 */
class ShellActivity : BridgeActivity() {
    private val app get() = KbCapture.of(this)

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ShellPlugin::class.java)
        super.onCreate(savedInstanceState)
        bridge.webView.setBackgroundColor(getColor(R.color.kb_background))
        bridge.setWebViewClient(ShellWebViewClient(bridge))
        askToNotify()
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val webView = bridge.webView
                    val history = webView.copyBackForwardList()
                    val previous = history.getItemAtIndex(history.currentIndex - 1)?.url
                    when (val back = Routes.back(webView.url, previous, app.pairings.all.value)) {
                        Back.GoBack -> webView.goBack()
                        is Back.Load -> webView.loadUrl(back.url)
                        Back.Leave -> finish()
                    }
                }
            },
        )
    }

    /** A launch, a `kb://` link, the widget and the tile all arrive here ([BridgeActivity] passes the first intent too). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val link = if (intent.action == Intent.ACTION_VIEW) intent.dataString else null
        if (intent.action == Intent.ACTION_MAIN && bridge.webView.url != null && !Routes.isShell(bridge.webView.url)) return
        bridge.webView.loadUrl(Routes.forLink(link, app.pairings.current))
    }

    /** Delivery tells the person about a refused capture or a paused store ([DeliveryNotices]); Android 13+ asks first. */
    private fun askToNotify() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    /** Opening the app is a reason to try again: a capture waiting on a sleeping host goes out now. */
    override fun onResume() {
        super.onResume()
        DeliveryWorker.schedule(this)
    }

    /**
     * Capacitor's client, plus one rule: when a store's UI does not load
     * (offline, the host asleep, a proxy's 5xx, a capture-only listener's
     * 403), the queue is shown in its place, saying why, rather than a
     * broken page.
     */
    private inner class ShellWebViewClient(bridge: Bridge) : BridgeWebViewClient(bridge) {
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            super.onReceivedError(view, request, error)
            if (request.isForMainFrame) offline(view, request, error.description?.toString() ?: "it did not load")
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            super.onReceivedHttpError(view, request, response)
            if (request.isForMainFrame && response.statusCode >= 400) offline(view, request, "HTTP ${response.statusCode}")
        }

        private fun offline(view: WebView, request: WebResourceRequest, why: String) {
            val url = request.url.toString()
            if (Routes.isShell(url)) return
            view.loadUrl(Routes.offline(Routes.storeOf(url, app.pairings.all.value), why))
        }
    }
}
