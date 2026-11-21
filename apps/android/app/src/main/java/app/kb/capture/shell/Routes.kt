package app.kb.capture.shell

import app.kb.capture.pairing.Pairing
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

/** A validated store origin and 32-character lowercase hex pairing code from a `kb://pair` link. */
data class PairLink(val url: String, val code: String)

/**
 * Which of the app's two WebViews shows a URL: the shell's page, a store's
 * UI, the browser for anything else, or nowhere at all for any other
 * address on the shell's own origin.
 */
enum class Pane { Shell, Store, Outside, Nowhere }

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

    /** The Stores view with its pairing form prefilled from a validated [PairLink]; never pairs on its own. */
    fun pair(link: PairLink): String = "$STORES?url=${encode(link.url)}&code=${encode(link.code)}"

    /**
     * Parses and validates a `kb://pair?url=<origin>&code=<code>` deep link.
     *
     * Requires an `https://` origin (`http://` only when [allowHttp] is true,
     * matching the debug build's network policy) with no path, query, fragment
     * or userinfo, and a 32-character hex pairing code (normalized to
     * lowercase). Returns null for anything else.
     */
    fun parsePairLink(link: String?, allowHttp: Boolean = false): PairLink? {
        val uri = link?.let { runCatching { URI(it) }.getOrNull() } ?: return null
        if (!uri.scheme.equals("kb", ignoreCase = true)) return null
        if (!uri.host.equals("pair", ignoreCase = true)) return null
        if (!uri.rawPath.isNullOrEmpty() && uri.rawPath != "/") return null
        val params = parseQuery(uri.rawQuery)
        val rawUrl = params["url"]?.trim() ?: return null
        val rawCode = params["code"]?.trim() ?: return null
        if (!PAIR_CODE.matches(rawCode)) return null
        val normalizedOrigin = parseOrigin(rawUrl, allowHttp) ?: return null
        return PairLink(url = normalizedOrigin, code = rawCode.lowercase())
    }

    /**
     * Whether [url] is one of the shell's own views: the bundled page at the
     * root of [SHELL], with one of the fragment routes it draws. Nothing else
     * on that origin is. Capacitor serves local files there too, and its
     * WebView holds the bridge, so a store's page that names any other path
     * must not get it loaded.
     */
    fun isShell(url: String?): Boolean {
        val uri = url?.let { runCatching { URI(it) }.getOrNull() } ?: return false
        return origin(url) == origin(SHELL) &&
            (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/") &&
            uri.rawQuery == null &&
            (uri.rawFragment ?: "").substringBefore('?') in VIEWS
    }

    /** The fragment routes the shell's page draws (`shell.js`), its root included. */
    private val VIEWS = setOf("", "/", "/stores", "/queue", "/capture")

    /** The paired store whose UI [url] is a page of, by origin. */
    fun storeOf(url: String?, stores: List<Pairing>): Pairing? {
        val at = url?.let(::origin) ?: return null
        return stores.firstOrNull { origin(it.url) == at }
    }

    /**
     * Where a launch or a `kb://` link goes. A plain launch opens the current
     * store's UI (Stores when none is paired); `kb://capture` opens Capture;
     * `kb://pair?url=<origin>&code=<code>` opens Stores with the pair form
     * prefilled when valid; `kb://open/<path>` opens `<path>` in the current
     * store's UI; `kb://stores` and anything else open Stores.
     */
    fun forLink(link: String?, current: Pairing?, allowHttp: Boolean = false): String {
        if (link == null) return current?.let(::home) ?: STORES
        val uri = runCatching { URI(link) }.getOrNull()
        if (uri?.scheme != "kb") return STORES
        return when (uri.host) {
            "capture" -> CAPTURE
            "queue" -> QUEUE
            "pair" -> parsePairLink(link, allowHttp)?.let(::pair) ?: STORES
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

    /**
     * The pane that shows [url]: the shell's views in Capacitor's WebView, a
     * paired store's UI in the store's, any other address on the shell's
     * origin nowhere, and anything else outside.
     */
    fun paneFor(url: String?, stores: List<Pairing>): Pane =
        when {
            isShell(url) -> Pane.Shell
            url != null && origin(url) == origin(SHELL) -> Pane.Nowhere
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

    private val PAIR_CODE = Regex("^[0-9a-fA-F]{32}$")

    private fun parseQuery(rawQuery: String?): Map<String, String> {
        if (rawQuery.isNullOrEmpty()) return emptyMap()
        val out = linkedMapOf<String, String>()
        for (part in rawQuery.split('&')) {
            if (part.isEmpty()) continue
            val eq = part.indexOf('=')
            val rawKey = if (eq == -1) part else part.substring(0, eq)
            val rawVal = if (eq == -1) "" else part.substring(eq + 1)
            val key = runCatching { URLDecoder.decode(rawKey, "UTF-8") }.getOrNull() ?: continue
            val value = runCatching { URLDecoder.decode(rawVal, "UTF-8") }.getOrNull() ?: continue
            out[key] = value
        }
        return out
    }

    private fun parseOrigin(url: String, allowHttp: Boolean): String? {
        val u = runCatching { URI(url) }.getOrNull() ?: return null
        val scheme = u.scheme?.lowercase() ?: return null
        if (scheme != "https" && !(allowHttp && scheme == "http")) return null
        if (u.rawUserInfo != null || u.rawQuery != null || u.rawFragment != null) return null
        if (!u.rawPath.isNullOrEmpty() && u.rawPath != "/") return null
        val host = u.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        if (u.port != -1 && u.port !in 1..65535) return null
        val port = if (u.port != -1) ":${u.port}" else ""
        return "$scheme://$host$port"
    }

    private fun encode(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
