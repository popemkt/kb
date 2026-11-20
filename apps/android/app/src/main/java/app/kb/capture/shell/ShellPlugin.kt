package app.kb.capture.shell

import android.net.Uri
import app.kb.capture.KbCapture
import app.kb.capture.capture.PayloadWriter
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer

/**
 * `KbShell`, the one plugin the shell's own page calls: [Shell]'s moves,
 * translated from and to JSON, plus `open` and `show`, which move the
 * WebView. Capacitor injects its bridge only into the shell's origin
 * ([Routes.SHELL]), so a store's UI cannot reach this plugin.
 *
 * The page hears `state` whenever the queue or the pairings change.
 */
@CapacitorPlugin(name = "KbShell")
class ShellPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val app get() = KbCapture.of(context)

    override fun load() {
        scope.launch {
            combine(app.queue.items, app.pairings.all) { _, _ -> }.collect {
                notifyListeners("state", encode(ShellState.serializer(), io { app.shell.state() }))
            }
        }
    }

    override fun handleOnDestroy() = scope.cancel()

    /** Links within the shell's page and paired stores' UIs stay in the WebView; Capacitor opens any other outside. */
    override fun shouldOverrideLoad(url: Uri): Boolean? = if (Routes.staysInApp(url.toString(), app.pairings.all.value)) false else null

    @PluginMethod
    fun state(call: PluginCall) = answer(call, ShellState.serializer()) { app.shell.state() }

    @PluginMethod
    fun pair(call: PluginCall) {
        val url = call.getString("url")?.trim().orEmpty()
        val code = call.getString("code")?.trim().orEmpty()
        if (url.isEmpty() || code.isEmpty()) return call.reject("Enter the store's URL and its pairing code.")
        answer(call, PairView.serializer()) { app.shell.pair(url, code) }
    }

    @PluginMethod
    fun forget(call: PluginCall) = act(call) { app.shell.forget(call.getString("key").orEmpty()) }

    @PluginMethod
    fun enqueue(call: PluginCall) {
        val text = call.getString("text").orEmpty()
        if (text.isBlank()) return call.reject("Nothing to capture.")
        act(call) { app.shell.enqueue(text) }
    }

    @PluginMethod
    fun retry(call: PluginCall) = act(call) { app.shell.retry(call.getString("id").orEmpty()) }

    @PluginMethod
    fun discard(call: PluginCall) = act(call) { app.shell.discard(call.getString("id").orEmpty()) }

    /** Opens a paired store's UI by key, at a path of the UI's own (`kb://open/<path>` semantics). */
    @PluginMethod
    fun open(call: PluginCall) {
        val store = app.pairings.byKey(call.getString("key").orEmpty()) ?: return call.reject("That store is not paired.")
        load(Routes.home(store))
        call.resolve()
    }

    /** Shows one of the shell's own views: `stores`, `queue` or `capture`. */
    @PluginMethod
    fun show(call: PluginCall) {
        load(Routes.forLink("kb://${call.getString("view") ?: "stores"}", app.pairings.current))
        call.resolve()
    }

    private fun load(url: String) = bridge.executeOnMainThread { bridge.webView.loadUrl(url) }

    private fun <T> answer(call: PluginCall, serializer: KSerializer<T>, block: () -> T) {
        scope.launch {
            runCatching { io(block) }
                .onSuccess { call.resolve(encode(serializer, it)) }
                .onFailure { call.reject(it.message ?: it.javaClass.simpleName) }
        }
    }

    private fun act(call: PluginCall, block: () -> Unit) = answer(call, ShellState.serializer()) { block(); app.shell.state() }

    private suspend fun <T> io(block: () -> T): T = kotlinx.coroutines.withContext(Dispatchers.IO) { block() }

    private fun <T> encode(serializer: KSerializer<T>, value: T) = JSObject(PayloadWriter.json.encodeToString(serializer, value))
}
