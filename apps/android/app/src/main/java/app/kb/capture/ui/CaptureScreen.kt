package app.kb.capture.ui

import android.os.Build
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.kb.capture.KbCapture
import app.kb.capture.capture.CAPTURE_CONTRACT
import app.kb.capture.capture.CaptureDraft
import app.kb.capture.delivery.Deliverer
import app.kb.capture.delivery.DeliveryWorker
import app.kb.capture.delivery.PairOutcome
import app.kb.capture.pairing.Pairing
import app.kb.capture.queue.QueuedCapture
import app.kb.capture.queue.Status
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CaptureScreen(app: KbCapture) {
    val items by app.queue.items.collectAsStateWithLifecycle()
    val pairings by app.pairings.all.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val shown = Status.entries[tab]
    Scaffold(topBar = { TopAppBar(title = { Text("kb capture") }) }) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { PairingCard(app, pairings) }
            item { ManualCapture(app, pairings.firstOrNull()) }
            item {
                PrimaryTabRow(selectedTabIndex = tab) {
                    Status.entries.forEachIndexed { index, status ->
                        val count = items.count { it.state.status == status }
                        Tab(selected = tab == index, onClick = { tab = index }, text = { Text("${status.name} $count", maxLines = 1, softWrap = false) })
                    }
                }
            }
            val rows = items.filter { it.state.status == shown }
            if (rows.isEmpty()) {
                item { Text("Nothing ${shown.name.lowercase()}.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            items(rows, key = { it.capture.captureId }) { CaptureRow(app, it, pairings) }
        }
    }
}

@Composable
private fun PairingCard(app: KbCapture, pairings: List<Pairing>) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var adding by rememberSaveable { mutableStateOf(false) }
    var url by rememberSaveable { mutableStateOf("https://") }
    var code by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Stores", style = MaterialTheme.typography.titleMedium)
            pairings.forEachIndexed { index, p ->
                Column {
                    Text(p.name + if (index == 0) "  ·  new shares go here" else "", style = MaterialTheme.typography.bodyLarge)
                    Text(p.url, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(contractLine(p), style = MaterialTheme.typography.bodySmall, color = contractColor(p))
                    Row {
                        TextButton(onClick = { app.pairings.forget(p.key) }) { Text("Forget") }
                    }
                }
            }
            if (pairings.isEmpty() || adding) {
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("Store URL") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it },
                    label = { Text("Pairing code") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Button(
                        enabled = !busy && url.length > "https://".length && code.isNotBlank(),
                        onClick = {
                            busy = true
                            message = null
                            scope.launch {
                                val outcome = withContext(Dispatchers.IO) { app.pairer.pair(url, code, Build.MODEL ?: "Android") }
                                busy = false
                                when (outcome) {
                                    is PairOutcome.Paired -> {
                                        code = ""
                                        adding = false
                                        Toast.makeText(context, "Paired · ${outcome.pairing.name}", Toast.LENGTH_SHORT).show()
                                        DeliveryWorker.schedule(context)
                                    }
                                    is PairOutcome.Failed -> message = outcome.reason
                                }
                            }
                        },
                    ) { Text(if (busy) "Pairing…" else "Pair") }
                    if (pairings.isNotEmpty()) TextButton(onClick = { adding = false }) { Text("Cancel") }
                }
                message?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            } else {
                OutlinedButton(onClick = { adding = true }) { Text("Pair a store") }
            }
        }
    }
}

private fun contractLine(p: Pairing): String =
    when {
        p.paused != null -> "Paused: ${p.paused}. Pair again."
        p.accepts.isEmpty() -> "Capture contract not confirmed yet (this phone sends v$CAPTURE_CONTRACT)."
        CAPTURE_CONTRACT in p.accepts -> "Accepts v$CAPTURE_CONTRACT · in step with this phone"
        else -> Deliverer.versionReason(p.name, p.accepts, CAPTURE_CONTRACT) + " Shares stay queued."
    }

@Composable
private fun contractColor(p: Pairing) =
    if (p.paused == null && CAPTURE_CONTRACT in p.accepts) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error

@Composable
private fun ManualCapture(app: KbCapture, store: Pairing?) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var text by rememberSaveable { mutableStateOf("") }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                label = { Text("Capture to ${store?.name ?: "this phone (not paired)"}") },
                minLines = 2,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = text.isNotBlank(),
                onClick = {
                    val draft = CaptureDraft(text = text)
                    scope.launch {
                        val queued = withContext(Dispatchers.IO) { runCatching { app.queue.enqueue(draft, store?.key) } }
                        if (queued.isSuccess) {
                            text = ""
                            DeliveryWorker.schedule(context)
                        } else {
                            Toast.makeText(context, "Not queued: ${queued.exceptionOrNull()?.message}", Toast.LENGTH_LONG).show()
                        }
                    }
                },
            ) { Text("Queue") }
        }
    }
}

@Composable
private fun CaptureRow(app: KbCapture, item: QueuedCapture, pairings: List<Pairing>) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = item.capture
    val s = item.state
    val storeName = s.store?.let { key -> pairings.firstOrNull { it.key == key }?.name ?: key } ?: "not paired"
    fun act(block: () -> Unit) = scope.launch { withContext(Dispatchers.IO) { block() } }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(c.summary(), style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val meta =
                buildList {
                    add(storeName)
                    add(c.capturedAt.take(16).replace('T', ' '))
                    if (c.files.isNotEmpty()) add("${c.files.size} file${if (c.files.size == 1) "" else "s"}")
                    c.source?.app?.let { add("from $it") }
                    if (s.attempts > 0) add("${s.attempts} attempt${if (s.attempts == 1) "" else "s"}")
                }.joinToString("  ·  ")
            Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            s.reason?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = if (s.status == Status.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
            }
            s.receipt?.let {
                Text("node ${it.nodeId}", style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row {
                when (s.status) {
                    Status.Pending -> TextButton(onClick = { DeliveryWorker.schedule(context) }) { Text("Retry now") }
                    Status.Failed ->
                        TextButton(onClick = {
                            act {
                                app.queue.update(c.captureId) { it.copy(status = Status.Pending, reason = null) }
                                DeliveryWorker.schedule(context)
                            }
                        }) { Text("Retry") }
                    Status.Sent -> Unit
                }
                Spacer(Modifier.width(4.dp))
                TextButton(onClick = { act { app.queue.discard(c.captureId) } }) { Text(if (s.status == Status.Sent) "Remove" else "Discard") }
            }
        }
    }
}
