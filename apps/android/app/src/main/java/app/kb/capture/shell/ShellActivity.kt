package app.kb.capture.shell

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import app.kb.capture.KbCapture
import app.kb.capture.R
import app.kb.capture.delivery.DeliveryWorker
import com.getcapacitor.BridgeActivity

/**
 * The app: two WebViews, one shown at a time ([Pane]). Capacitor's shows the
 * shell's own bundled page (Stores, the queue, Capture) and holds the
 * bridge to the Kotlin core. A [StoreWebView] shows a paired store's own kb
 * UI, loaded from the store as a browser would load it, with no bridge and
 * no native interface. Every move goes through [show], which picks the pane
 * by [Routes.paneFor]. The activity owns the three things the pages cannot:
 * what a launch or a `kb://` link opens, the back button, and the queue in
 * place of a store UI that did not load.
 */
class ShellActivity : BridgeActivity() {
    private val app get() = KbCapture.of(this)
    private val shellView: WebView get() = bridge.webView

    /**
     * Made on first use, beside Capacitor's WebView: [BridgeActivity] hands
     * the first intent to [onNewIntent] from inside `super.onCreate`, once
     * the bridge exists.
     */
    internal val storeView: StoreWebView by lazy {
        StoreWebView(this).also {
            it.setBackgroundColor(getColor(R.color.kb_background))
            it.visibility = View.GONE
            it.webViewClient = StoreClient()
            it.webChromeClient = StoreChrome()
            (shellView.parent as ViewGroup).addView(it, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
    }

    private val shown: WebView get() = if (storeView.visibility == View.VISIBLE) storeView else shellView

    /**
     * Set by each open of a store. The open's first page, once loaded, starts
     * the store pane's history, so Back from it goes to Stores and not into a
     * visit before the open.
     */
    private var opening = false

    private var choosing: ValueCallback<Array<Uri>>? = null
    private val chooseFiles =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            choosing?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
            choosing = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ShellPlugin::class.java)
        super.onCreate(savedInstanceState)
        shellView.setBackgroundColor(getColor(R.color.kb_background))
        askToNotify()
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val view = shown
                    val history = view.copyBackForwardList()
                    val previous = if (history.currentIndex > 0) history.getItemAtIndex(history.currentIndex - 1)?.url else null
                    when (val back = Routes.back(view.url, previous, app.pairings.all.value)) {
                        Back.GoBack -> view.goBack()
                        is Back.Load -> show(back.url)
                        Back.Leave -> finish()
                    }
                }
            },
        )
    }

    /**
     * Shows [url] in its pane ([Routes.paneFor]): the shell's views, a store's
     * UI, or the browser for anything else. Any other address on the shell's
     * origin is refused, because that WebView holds the bridge.
     */
    fun show(url: String) {
        when (Routes.paneFor(url, app.pairings.all.value)) {
            Pane.Shell -> {
                if (shellView.url != url) shellView.loadUrl(url)
                reveal(shellView, storeView)
            }
            Pane.Store -> {
                opening = true
                storeView.loadUrl(url)
                reveal(storeView, shellView)
            }
            Pane.Outside ->
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (_: ActivityNotFoundException) {
                    // Nothing on the phone opens it; the page stays where it was.
                }
            Pane.Nowhere -> Unit
        }
    }

    private fun reveal(view: WebView, hidden: WebView) {
        hidden.visibility = View.GONE
        view.visibility = View.VISIBLE
        view.requestFocus()
    }

    /** Debug builds accept plain HTTP origins, matching `debug/AndroidManifest.xml`; release builds are HTTPS only. */
    private val allowHttp: Boolean get() = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    /** A launch, a `kb://` link, the widget and the tile all arrive here ([BridgeActivity] passes the first intent too). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val link = if (intent.action == Intent.ACTION_VIEW) intent.dataString else null
        if (intent.action == Intent.ACTION_MAIN && storeView.visibility == View.VISIBLE) return
        show(Routes.forLink(link, app.pairings.current, allowHttp))
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
     * The store pane's navigation: its own store's pages stay, anything else
     * goes through [show]. An open's first page starts the pane's history. When a store's UI does not load (offline, the host
     * asleep, a proxy's 5xx, a capture-only listener's 403), the queue is
     * shown in its place, saying why, rather than a broken page.
     */
    private inner class StoreClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (Routes.paneFor(url, app.pairings.all.value) == Pane.Store) return false
            show(url)
            return true
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (!opening) return
            opening = false
            view.clearHistory()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) offline(request, error.description?.toString() ?: "it did not load")
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame && response.statusCode >= 400) offline(request, "HTTP ${response.statusCode}")
        }

        private fun offline(request: WebResourceRequest, why: String) =
            show(Routes.offline(Routes.storeOf(request.url.toString(), app.pairings.all.value), why))
    }

    /** A browser's dialogs, and its file picker for the UI's attachments. */
    private inner class StoreChrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            choosing?.onReceiveValue(null)
            choosing = callback
            return try {
                chooseFiles.launch(params.createIntent())
                true
            } catch (_: ActivityNotFoundException) {
                choosing = null
                false
            }
        }
    }
}
