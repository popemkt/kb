package app.kb.capture.shell

import app.kb.capture.pairing.Pairing
import java.net.URI
import java.net.URLEncoder

/** Which of the app's two WebViews shows a URL, or neither: the shell's page, a store's UI, or the browser. */
enum class Pane { Shell, Store, Outside }

/** What the back button does: step back in the shown page's own history, show a URL, or leave the app. */
sealed interface Back {
    data object GoBack : Back

    data class Load(val url: String) : Back

    data object Leave : Back
}

/**
 * Where the app goes, decided from URLs alone, so every decision is tested
 * on the JVM. Two kinds of page are ever shown, each in its own WebView
 * ([Pane]): the shell's own page, bundled with the app and served by
 * Capacitor at [SHELL], with its views in the fragment (`#/stores`,
 * `#/queue`, `#/capture`); and a paired store's own kb UI, at the URL it was
 * paired with, in a [StoreWebView] no bridge touches. The shell keeps no
 * route table for the store's UI: a `kb://open/<path>` link names the UI's
 * own path, which the shell appends to the store's URL.
 */
object Routes {
    /** The origin Capacitor serves the bundled page from; its bridge is injected there and nowhere else. */
    const val SHELL = "https://localhost"
    const val STORES = "$SHELL/#/stores"
    const val CAPTURE = "$SHELL/#/capture"
    const val QUEUE = "$SHELL/#/queue"

    /** The queue, shown because [store]'s UI did not load, with why. */
    fun offline(store: Pairing?, why: String): String =
        "$QUEUE?offline=${encode(store?.name ?: "the store")}&why=${encode(why)}"

    fun isShell(url: String?): Boolean = url != null && origin(url) == origin(SHELL)

    /** The paired store whose UI [url] is a page of, by origin. */
    fun storeOf(url: String?, stores: List<Pairing>): Pairing? {
        val at = url?.let(::origin) ?: return null
        return stores.firstOrNull { origin(it.url) == at }
    }

    /**
     * Where a launch or a `kb://` link goes. A plain launch opens the current
     * store's UI (Stores when none is paired); `kb://capture` opens Capture;
     * `kb://open/<path>` opens `<path>` in the current store's UI; `kb://stores`
     * and anything else open Stores.
     */
    fun forLink(link: String?, current: Pairing?): String {
        if (link == null) return current?.let(::home) ?: STORES
        val uri = runCatching { URI(link) }.getOrNull()
        if (uri?.scheme != "kb") return STORES
        return when (uri.host) {
            "capture" -> CAPTURE
            "queue" -> QUEUE
            "open" -> current?.let { home(it) + (uri.rawPath ?: "").trimStart('/') + (uri.rawQuery?.let { q -> "?$q" } ?: "") + (uri.rawFragment?.let { f -> "#$f" } ?: "") } ?: STORES
            else -> STORES
        }
    }

    /** A store's UI, at its root. */
    fun home(store: Pairing): String = store.url.trimEnd('/') + "/"

    /**
     * Back from [current], whose previous history entry is [previous]: within a
     * store's UI, the UI's own history; from its first page, Stores; from a
     * shell view other than Stores, Stores; from Stores, out of the app. The
     * shell's own entries are never stepped back into, so a page that failed
     * to load is not loaded again by going back.
     */
    fun back(current: String?, previous: String?, stores: List<Pairing>): Back {
        val store = storeOf(current, stores)
        return when {
            store != null && previous != null && storeOf(previous, stores) == store -> Back.GoBack
            store != null -> Back.Load(STORES)
            isShell(current) && current?.substringAfter('#', "") != "/stores" -> Back.Load(STORES)
            else -> Back.Leave
        }
    }

    /** The pane that shows [url]: the shell's page in Capacitor's WebView, a paired store's UI in the store's, anything else outside. */
    fun paneFor(url: String?, stores: List<Pairing>): Pane =
        when {
            isShell(url) -> Pane.Shell
            storeOf(url, stores) != null -> Pane.Store
            else -> Pane.Outside
        }

    private fun origin(url: String): String? =
        runCatching {
            val u = URI(url)
            val scheme = u.scheme?.lowercase() ?: return null
            val host = u.host?.lowercase() ?: return null
            val port = if (u.port != -1) u.port else if (scheme == "https") 443 else if (scheme == "http") 80 else -1
            "$scheme://$host:$port"
        }.getOrNull()

    private fun encode(s: String) = URLEncoder.encode(s, Charsets.UTF_8).replace("+", "%20")
}
