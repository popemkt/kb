package app.kb.capture

import android.content.Intent
import android.content.pm.PackageInfo
import android.net.Uri
import android.os.Looper
import android.view.View
import android.webkit.WebResourceRequest
import androidx.work.testing.WorkManagerTestInitHelper
import app.kb.capture.pairing.Pairings
import app.kb.capture.shell.Routes
import app.kb.capture.shell.ShellActivity
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowWebView

/**
 * The real activity, Capacitor included, on Robolectric's WebView. That
 * WebView has no WebMessageListener, so Capacitor takes its fallback and
 * puts an origin-wide `androidBridge` interface on its own WebView: the case
 * in which a store's page loaded there could reach the queue. These tests
 * hold that a store's UI never loads there, and that the WebView it does
 * load in has no native interface and cannot be given one.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [NoServiceWorkers::class])
class ShellActivityTest {
    private val store = "https://kb.tail.ts.net"

    @Before
    fun pairOneStore() {
        val app = RuntimeEnvironment.getApplication()
        WorkManagerTestInitHelper.initializeTestWorkManager(app)
        ShadowWebView.setCurrentWebViewPackage(PackageInfo().apply { packageName = "com.google.android.webview"; versionName = "140.0.7339.0" })
        Pairings(File(app.filesDir, "pairings.json"), PlainVault).save("personal", "Personal", store, "tok", listOf(1), "2026-11-21T08:00:00.000+07:00")
    }

    private fun launch(intent: Intent = Intent(Intent.ACTION_MAIN)): ActivityController<ShellActivity> =
        Robolectric.buildActivity(ShellActivity::class.java, intent).setup()

    @Test
    fun `a store's UI runs in a WebView with no native interface, even where Capacitor falls back to one`() {
        val activity = launch().get()
        val shell = activity.getBridge().webView
        val storeView = activity.storeView

        assertNotNull("Capacitor took its fallback here", shadowOf(shell).getJavascriptInterface("androidBridge"))
        assertEquals("$store/", shadowOf(storeView).lastLoadedUrl)
        assertNull(shadowOf(storeView).getJavascriptInterface("androidBridge"))
        assertEquals(View.VISIBLE, storeView.visibility)
        assertEquals(View.GONE, shell.visibility)
        assertTrue(shadowOf(shell).lastLoadedUrl.let { it == null || Routes.isShell(it) })
        assertThrows(UnsupportedOperationException::class.java) { storeView.addJavascriptInterface(Any(), "androidBridge") }
    }

    @Test
    fun `every way to a store's page lands in the store's WebView, never in Capacitor's`() {
        val controller = launch()
        val activity = controller.get()
        val shell = activity.getBridge().webView

        controller.newIntent(Intent(Intent.ACTION_VIEW, Uri.parse("kb://queue")))
        assertEquals(View.VISIBLE, shell.visibility)
        assertEquals(Routes.QUEUE, shadowOf(shell).lastLoadedUrl)

        controller.newIntent(Intent(Intent.ACTION_VIEW, Uri.parse("kb://open/n/01ABC")))
        assertEquals("$store/n/01ABC", shadowOf(activity.storeView).lastLoadedUrl)

        activity.show(Routes.STORES)
        assertTrue("a link the shell's page follows to a store is not loaded there", activity.getBridge().launchIntent(Uri.parse("$store/n/02DEF")))
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("$store/n/02DEF", shadowOf(activity.storeView).lastLoadedUrl)
        assertEquals(View.VISIBLE, activity.storeView.visibility)
        assertFalse(Routes.isShell(shadowOf(activity.storeView).lastLoadedUrl))
        assertTrue(Routes.isShell(shadowOf(shell).lastLoadedUrl))
    }

    @Test
    fun `a store's page can hand off only to the shell's own views, never to another address on its origin`() {
        val activity = launch().get()
        val shell = activity.getBridge().webView
        val storeView = activity.storeView
        val client = shadowOf(storeView).webViewClient
        val before = shadowOf(shell).lastLoadedUrl

        for (url in listOf(
            "https://localhost/_capacitor_file_/data/user/0/app.kb.capture/files/pairings.json",
            "https://localhost/shell.js",
            "https://localhost/index.html#/stores",
        )) {
            assertTrue(url, client.shouldOverrideUrlLoading(storeView, request(url)))
            assertEquals(url, before, shadowOf(shell).lastLoadedUrl)
            assertEquals(url, View.VISIBLE, storeView.visibility)
        }

        assertTrue(client.shouldOverrideUrlLoading(storeView, request(Routes.CAPTURE)))
        assertEquals(Routes.CAPTURE, shadowOf(shell).lastLoadedUrl)
        assertEquals(View.VISIBLE, shell.visibility)
    }

    @Test
    fun `reopening a store starts its history afresh, so Back goes to Stores and not into an earlier visit`() {
        val activity = launch().get()
        val shell = activity.getBridge().webView
        activity.finishLoading("$store/")
        assertEquals(1, activity.storeView.copyBackForwardList().size)

        activity.finishLoading("$store/n/old")
        activity.show(Routes.STORES)
        activity.show("$store/")
        activity.finishLoading("$store/")
        assertEquals(1, activity.storeView.copyBackForwardList().size)

        activity.onBackPressedDispatcher.onBackPressed()
        assertEquals(View.VISIBLE, shell.visibility)
        assertEquals(Routes.STORES, shadowOf(shell).lastLoadedUrl)
    }

    /**
     * The store pane finishes loading [url], as a real WebView would: the
     * page joins the history, then the client hears it finished. Robolectric's
     * WebView keeps no history of its own, and its clearHistory drops every
     * entry where a real one keeps the page it shows, so that page is put back.
     */
    private fun ShellActivity.finishLoading(url: String) {
        val shadow = shadowOf(storeView)
        shadow.pushEntryToHistory(url)
        val size = storeView.copyBackForwardList().size
        shadow.webViewClient.onPageFinished(storeView, url)
        if (storeView.copyBackForwardList().size < size) shadow.pushEntryToHistory(url)
    }

    private fun request(url: String) =
        object : WebResourceRequest {
            override fun getUrl(): Uri = Uri.parse(url)

            override fun isForMainFrame() = true

            override fun isRedirect() = false

            override fun hasGesture() = true

            override fun getMethod() = "GET"

            override fun getRequestHeaders() = emptyMap<String, String>()
        }
}
