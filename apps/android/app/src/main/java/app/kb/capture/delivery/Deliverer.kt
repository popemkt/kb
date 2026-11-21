package app.kb.capture.delivery

import app.kb.capture.capture.CAPTURE_CONTRACT
import app.kb.capture.capture.CAPTURE_SUBMIT
import app.kb.capture.capture.CaptureTarget
import app.kb.capture.capture.PayloadWriter
import app.kb.capture.capture.isoWithOffset
import app.kb.capture.pairing.Pairing
import app.kb.capture.pairing.Pairings
import app.kb.capture.queue.CaptureQueue
import app.kb.capture.queue.QueuedCapture
import app.kb.capture.queue.Receipt
import app.kb.capture.queue.Status
import java.time.OffsetDateTime
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The host's answer to "which capture contracts do you accept?", asked once per store per run. */
private sealed interface ContractCheck {
    data class Accepts(val versions: List<Int>) : ContractCheck

    data class Waiting(val reason: String) : ContractCheck

    data class Paused(val reason: String) : ContractCheck
}

/**
 * Delivers the queue: every pending capture goes to the store it is pinned
 * to, after that host confirms it still accepts the capture's contract
 * version, and its outcome is written back to the entry.
 *
 * - committed: the entry is sent and its bytes are released;
 * - refused for a reason of the capture's own (bad input, missing parent…):
 *   failed, with the reason, until the person retries or discards it;
 * - the host lacks the action or the version, or cannot be reached: pending,
 *   with the reason, and the run asks to be retried;
 * - the credential is refused: the pairing is paused and its captures wait
 *   for the person to pair again.
 *
 * A refusal and a pause are also told to [notices], once each.
 *
 * The host is idempotent on `captureId`, so a capture whose answer was lost
 * is simply sent again.
 */
class Deliverer(
    private val queue: CaptureQueue,
    private val pairings: Pairings,
    private val host: CaptureHost,
    private val notices: Notices = Notices.None,
) {
    /**
     * Delivers what it can; true when something is left that a later run may
     * deliver. [keepGoing] is asked before each capture, so a run that was
     * replaced stops at the next one.
     */
    fun deliverAll(keepGoing: () -> Boolean = { true }): Boolean {
        pairings.current?.let { queue.pinUnpinned(it.key) }
        val checks = mutableMapOf<String, ContractCheck>()
        var retry = false
        val pending = queue.all().filter { it.state.status == Status.Pending }.sortedBy { it.capture.capturedAt }
        for (entry in pending) {
            if (!keepGoing()) return true
            val id = entry.capture.captureId
            val key = entry.state.store
            val pairing = key?.let { pairings.byKey(it) }
            when {
                key == null -> wait(id, "Not paired yet. Pair a store to send it.")
                pairing == null -> wait(id, "$key is no longer paired on this phone.")
                pairing.paused != null -> wait(id, "${pairing.name} refused this phone (${pairing.paused}). Pair again.")
                else ->
                    when (val check = checks.getOrPut(key) { checkContract(pairing) }) {
                        is ContractCheck.Paused -> wait(id, check.reason)
                        is ContractCheck.Waiting -> {
                            wait(id, check.reason)
                            retry = true
                        }
                        is ContractCheck.Accepts ->
                            if (entry.capture.version !in check.versions) {
                                wait(id, versionReason(pairing.name, check.versions, entry.capture.version))
                                retry = true
                            } else if (!submit(entry, pairing)) {
                                retry = true
                            }
                    }
            }
        }
        return retry
    }

    /** Sends one capture; false when it stays pending for a later run. */
    private fun submit(entry: QueuedCapture, pairing: Pairing): Boolean {
        val id = entry.capture.captureId
        val capture = entry.capture.copy(target = CaptureTarget(store = pairing.key, parent = entry.capture.target?.parent))
        val answer =
            host.call(pairing.url, pairings.token(pairing), CAPTURE_SUBMIT) { out ->
                PayloadWriter.write(capture, { queue.openFile(id, it) }, out)
            }
        return when (answer) {
            is Answer.Ok -> {
                val output = answer.output as? JsonObject
                val nodeId = output?.get("nodeId")?.jsonPrimitive?.contentOrNull ?: "(no node id)"
                val store = output?.get("store")?.let { s -> (s as? JsonPrimitive)?.contentOrNull ?: s.jsonObject["key"]?.jsonPrimitive?.contentOrNull }
                queue.markSent(id, Receipt(nodeId = nodeId, store = store ?: pairing.key))
                true
            }
            is Answer.Refused ->
                if (answer.code == "unknown_action") {
                    wait(id, "${pairing.name} has no $CAPTURE_SUBMIT action yet.")
                    false
                } else {
                    val reason = "${answer.code}: ${answer.message}"
                    queue.update(id) { it.copy(status = Status.Failed, attempts = it.attempts + 1, reason = reason) }
                    notices.refused(entry, pairing, reason)
                    true
                }
            is Answer.Unauthorized -> {
                pause(pairing, answer.message)
                wait(id, "${pairing.name} refused this phone (${answer.message}). Pair again.")
                true
            }
            is Answer.Unreachable -> {
                queue.update(id) { it.copy(attempts = it.attempts + 1, reason = "Not delivered yet: ${answer.message}") }
                false
            }
        }
    }

    private fun checkContract(pairing: Pairing): ContractCheck =
        when (val answer = host.call(pairing.url, pairings.token(pairing), MANIFEST, CaptureHost.body(MANIFEST, JsonObject(emptyMap())))) {
            is Answer.Ok -> {
                val versions = CaptureHost.acceptedContracts(answer.output)
                pairings.update(pairing.key) { it.copy(accepts = versions) }
                if (versions.isEmpty()) ContractCheck.Waiting("${pairing.name} does not accept captures yet (its kb.manifest names no captureContract).")
                else ContractCheck.Accepts(versions)
            }
            is Answer.Refused -> ContractCheck.Waiting("${pairing.name} would not say which captures it accepts: ${answer.message}")
            is Answer.Unauthorized -> {
                pause(pairing, answer.message)
                ContractCheck.Paused("${pairing.name} refused this phone (${answer.message}). Pair again.")
            }
            is Answer.Unreachable -> ContractCheck.Waiting("Waiting for ${pairing.name}: ${answer.message}")
        }

    /** Pauses a store; the person is told once, when it stops accepting this phone, not on every run after. */
    private fun pause(pairing: Pairing, why: String) {
        val newly = pairings.byKey(pairing.key)?.paused == null
        pairings.update(pairing.key) { it.copy(paused = why) }
        if (newly) notices.paused(pairing, why)
    }

    private fun wait(id: String, reason: String) {
        queue.update(id) { it.copy(reason = reason) }
    }

    companion object {
        const val MANIFEST = "kb.manifest"

        fun versionReason(store: String, accepts: List<Int>, version: Int): String =
            "$store accepts ${accepts.joinToString(", ") { "v$it" }}. This capture uses v$version."
    }
}

/** What pairing a store came to. */
sealed interface PairOutcome {
    data class Paired(val pairing: Pairing, val compatible: Boolean) : PairOutcome

    data class Failed(val reason: String) : PairOutcome
}

/**
 * Exchanges a one-use code the owner issued on the host (`capture.pair`) for
 * this device's credential, and records the pairing with the contract
 * versions the host accepts, so the screen can say at once whether this app
 * and that host agree.
 */
class Pairer(
    private val queue: CaptureQueue,
    private val pairings: Pairings,
    private val host: CaptureHost,
    private val now: () -> OffsetDateTime = OffsetDateTime::now,
) {
    fun pair(url: String, code: String, deviceName: String): PairOutcome {
        val input = JsonObject(mapOf("code" to JsonPrimitive(code.trim()), "deviceName" to JsonPrimitive(deviceName)))
        return when (val answer = host.call(url.trim(), null, PAIR, CaptureHost.body(PAIR, input))) {
            is Answer.Ok -> {
                val output = answer.output as? JsonObject ?: return PairOutcome.Failed("The host's answer named no credential.")
                val token = output["token"]?.jsonPrimitive?.contentOrNull ?: return PairOutcome.Failed("The host's answer named no credential.")
                val store = output["store"] as? JsonObject
                val key = store?.get("key")?.jsonPrimitive?.contentOrNull ?: url.trim()
                val name = store?.get("name")?.jsonPrimitive?.contentOrNull ?: key
                var accepts = CaptureHost.acceptedContracts(output)
                if (accepts.isEmpty()) {
                    val manifest = host.call(url.trim(), token, Deliverer.MANIFEST, CaptureHost.body(Deliverer.MANIFEST, JsonObject(emptyMap())))
                    if (manifest is Answer.Ok) accepts = CaptureHost.acceptedContracts(manifest.output)
                }
                val pairing = pairings.save(key, name, url.trim().trimEnd('/'), token, accepts, isoWithOffset(now()))
                queue.pinUnpinned(key)
                PairOutcome.Paired(pairing, CAPTURE_CONTRACT in accepts)
            }
            is Answer.Refused ->
                PairOutcome.Failed(
                    if (answer.code == "unknown_action") "This kb has no $PAIR action: update it to a version that accepts phone captures."
                    else "${answer.code}: ${answer.message}",
                )
            is Answer.Unauthorized -> PairOutcome.Failed("Refused: ${answer.message}")
            is Answer.Unreachable -> PairOutcome.Failed("Could not reach $url: ${answer.message}")
        }
    }

    companion object {
        const val PAIR = "capture.pair"
    }
}
