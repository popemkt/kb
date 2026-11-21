package app.kb.capture

import app.kb.capture.capture.CaptureDraft
import app.kb.capture.delivery.Answer
import app.kb.capture.delivery.CaptureHost
import app.kb.capture.delivery.Deliverer
import app.kb.capture.delivery.HttpCaptureHost
import app.kb.capture.delivery.NoAnswer
import app.kb.capture.delivery.PairOutcome
import app.kb.capture.delivery.Pairer
import app.kb.capture.queue.Status
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A host that answers from a script and records every call it was sent. */
class FakeHost(var manifest: Answer = ok("""{"captureContract":1}"""), var submit: (JsonObject) -> Answer = { ok("""{"captureId":"x","nodeId":"01NODE","store":"personal"}""") }) : CaptureHost {
    val calls = mutableListOf<Triple<String, String?, JsonObject>>()
    var pair: Answer = ok("""{"token":"tok-1","store":{"key":"personal","name":"Personal"},"captureContract":1}""")

    override fun call(url: String, token: String?, action: String, writeInput: (java.io.OutputStream) -> Unit): Answer {
        val out = ByteArrayOutputStream().also(writeInput)
        val body = app.kb.capture.capture.PayloadWriter.json.parseToJsonElement(out.toString(Charsets.UTF_8)).jsonObject
        calls += Triple(action, token, body)
        return when (action) {
            "kb.manifest" -> manifest
            "capture.pair" -> pair
            "capture.submit" -> submit(body["input"]!!.jsonObject)
            else -> Answer.Refused("unknown_action", action)
        }
    }

    companion object {
        fun ok(json: String) = Answer.Ok(app.kb.capture.capture.PayloadWriter.json.parseToJsonElement(json))
    }
}

class DelivererTest {
    private val root = tempDir()
    private val queue = newQueue(root)
    private val pairings = newPairings(root)
    private val host = FakeHost()
    private val deliverer = Deliverer(queue, pairings, host)

    private fun paired(key: String = "personal", name: String = "Personal", url: String = "https://kb.tail.ts.net") =
        pairings.save(key, name, url, "tok-$key", listOf(1), "2026-11-19T08:00:00.000+07:00")

    @Test
    fun `a committed capture is sent with the device token, and its receipt kept`() {
        paired()
        val id = queue.enqueue(mixedDraft(), "personal").capture.captureId
        assertFalse(deliverer.deliverAll())
        val entry = queue.get(id)!!
        assertEquals(Status.Sent, entry.state.status)
        assertEquals("01NODE", entry.state.receipt!!.nodeId)
        val submit = host.calls.single { it.first == "capture.submit" }
        assertEquals("tok-personal", submit.second)
        assertEquals(id, submit.third["input"]!!.jsonObject["captureId"]!!.jsonPrimitive.content)
        assertEquals("personal", submit.third["input"]!!.jsonObject["target"]!!.jsonObject["store"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a host that does not accept the capture's version keeps it queued with the reason`() {
        paired()
        host.manifest = FakeHost.ok("""{"captureContract":[2,3]}""")
        val id = queue.enqueue(CaptureDraft(text = "t"), "personal").capture.captureId
        assertTrue(deliverer.deliverAll())
        val state = queue.get(id)!!.state
        assertEquals(Status.Pending, state.status)
        assertEquals("Personal accepts v2, v3. This capture uses v1.", state.reason)
        assertTrue(host.calls.none { it.first == "capture.submit" })
        assertEquals(listOf(2, 3), pairings.byKey("personal")!!.accepts)
    }

    @Test
    fun `a host without a capture contract keeps captures queued, and drains once it has one`() {
        paired()
        host.manifest = FakeHost.ok("""{"actions":[]}""")
        val id = queue.enqueue(CaptureDraft(text = "t"), "personal").capture.captureId
        assertTrue(deliverer.deliverAll())
        assertEquals(Status.Pending, queue.get(id)!!.state.status)
        host.manifest = FakeHost.ok("""{"captureContract":1}""")
        assertFalse(deliverer.deliverAll())
        assertEquals(Status.Sent, queue.get(id)!!.state.status)
    }

    @Test
    fun `an unreachable host leaves the capture pending, counts the attempt and asks for a retry`() {
        paired()
        host.submit = { Answer.Unreachable(NoAnswer.TimedOut) }
        val id = queue.enqueue(CaptureDraft(text = "t"), "personal").capture.captureId
        assertTrue(deliverer.deliverAll())
        val state = queue.get(id)!!.state
        assertEquals(Status.Pending, state.status)
        assertEquals(1, state.attempts)
        assertEquals("Waiting for Personal: it did not answer in time.", state.reason)
    }

    @Test
    fun `a host that drops the connection is named in words, never as the exception`() {
        paired()
        // What the emulator smoke saw from a sleeping host (shot 07-queue-host-asleep).
        val dropped = IOException("unexpected end of stream on com.android.okhttp.Address@76c34e2c")
        host.manifest = Answer.Unreachable(HttpCaptureHost.noAnswer(dropped))
        val id = queue.enqueue(CaptureDraft(text = "t"), "personal").capture.captureId
        assertTrue(deliverer.deliverAll())
        assertEquals(
            "Waiting for Personal: the connection closed before it answered. It may be asleep or restarting.",
            queue.get(id)!!.state.reason,
        )
    }

    @Test
    fun `a server deadline leaves the capture pending until a later delivery succeeds`() {
        paired()
        host.submit = { HttpCaptureHost.interpret(503, "Request exceeded the 35000 ms deadline.") }
        val id = queue.enqueue(CaptureDraft(text = "t"), "personal").capture.captureId
        assertTrue(deliverer.deliverAll())
        val pending = queue.get(id)!!.state
        assertEquals(Status.Pending, pending.status)
        assertEquals(1, pending.attempts)
        assertEquals("Waiting for Personal: it hit an error on its side (HTTP 503).", pending.reason)

        host.submit = { FakeHost.ok("""{"nodeId":"01N"}""") }
        assertFalse(deliverer.deliverAll())
        assertEquals(Status.Sent, queue.get(id)!!.state.status)
        val submittedIds = host.calls.filter { it.first == "capture.submit" }.map {
            it.third["input"]!!.jsonObject["captureId"]!!.jsonPrimitive.content
        }
        assertEquals(listOf(id, id), submittedIds)
    }

    @Test
    fun `a permanent refusal fails the capture with the host's reason, and retry is the person's`() {
        paired()
        host.submit = { Answer.Refused("not_found", "inbox 01X does not exist") }
        val id = queue.enqueue(CaptureDraft(text = "t"), "personal").capture.captureId
        assertFalse(deliverer.deliverAll())
        val state = queue.get(id)!!.state
        assertEquals(Status.Failed, state.status)
        assertEquals("not_found: inbox 01X does not exist", state.reason)
        // A failed capture is not resent until the person retries it.
        host.submit = { FakeHost.ok("""{"nodeId":"01N"}""") }
        deliverer.deliverAll()
        assertEquals(Status.Failed, queue.get(id)!!.state.status)
    }

    @Test
    fun `a refused credential pauses the store, and its captures wait for pairing again`() {
        paired()
        host.submit = { Answer.Unauthorized("token revoked") }
        val a = queue.enqueue(CaptureDraft(text = "a"), "personal").capture.captureId
        val b = queue.enqueue(CaptureDraft(text = "b"), "personal").capture.captureId
        assertFalse("nothing to retry until the person pairs again", deliverer.deliverAll())
        assertEquals("token revoked", pairings.byKey("personal")!!.paused)
        assertEquals(1, host.calls.count { it.first == "capture.submit" })
        listOf(a, b).forEach { assertEquals(Status.Pending, queue.get(it)!!.state.status) }
        // Pairing again clears the pause and the queue drains.
        host.submit = { FakeHost.ok("""{"nodeId":"01N"}""") }
        paired()
        deliverer.deliverAll()
        listOf(a, b).forEach { assertEquals(Status.Sent, queue.get(it)!!.state.status) }
    }

    @Test
    fun `a capture goes to the store it was queued for, not the current default`() {
        paired("a", "A", "https://a.example")
        val forA = queue.enqueue(CaptureDraft(text = "for A"), "a").capture.captureId
        paired("b", "B", "https://b.example")
        assertEquals("b", pairings.current!!.key)
        deliverer.deliverAll()
        val submit = host.calls.single { it.first == "capture.submit" }
        assertEquals("tok-a", submit.second)
        assertEquals(Status.Sent, queue.get(forA)!!.state.status)
    }

    @Test
    fun `captures queued before any pairing wait, then go to the first store paired`() {
        val id = queue.enqueue(CaptureDraft(text = "early"), null).capture.captureId
        assertFalse(deliverer.deliverAll())
        assertEquals("Not paired yet. Pair a store to send it.", queue.get(id)!!.state.reason)
        val outcome = Pairer(queue, pairings, host, TickingClock()::now).pair("https://kb.tail.ts.net/", "123-456", "Pixel")
        assertTrue(outcome is PairOutcome.Paired && outcome.compatible)
        assertEquals("personal", queue.get(id)!!.state.store)
        deliverer.deliverAll()
        assertEquals(Status.Sent, queue.get(id)!!.state.status)
    }

    @Test
    fun `pairing sends the code and device name, seals the token, and reports compatibility`() {
        val outcome = Pairer(queue, pairings, host, TickingClock()::now).pair(" https://kb.tail.ts.net/ ", " 123-456 ", "Pixel 9")
        val pair = host.calls.single { it.first == "capture.pair" }
        assertNull("pairing carries no credential", pair.second)
        assertEquals("123-456", pair.third["input"]!!.jsonObject["code"]!!.jsonPrimitive.content)
        assertEquals("Pixel 9", pair.third["input"]!!.jsonObject["deviceName"]!!.jsonPrimitive.content)
        val pairing = (outcome as PairOutcome.Paired).pairing
        assertEquals("https://kb.tail.ts.net", pairing.url)
        assertEquals("sealed:tok-1", pairing.sealedToken)
        assertEquals("tok-1", pairings.token(pairing))
    }

    @Test
    fun `pairing a host whose contract differs succeeds and says so`() {
        host.pair = FakeHost.ok("""{"token":"t","store":{"key":"k","name":"K"},"captureContract":2}""")
        val outcome = Pairer(queue, pairings, host, TickingClock()::now).pair("https://x", "c", "d")
        assertFalse((outcome as PairOutcome.Paired).compatible)
    }

    @Test
    fun `pairing a host that is not listening says what to check`() {
        host.pair = Answer.Unreachable(NoAnswer.Refused)
        val outcome = Pairer(queue, pairings, host, TickingClock()::now).pair("http://127.0.0.1:4321", "c", "d")
        assertEquals(
            "Could not reach http://127.0.0.1:4321: nothing answers at its address. Is kb running there?",
            (outcome as PairOutcome.Failed).reason,
        )
    }

    @Test
    fun `pairing a kb without the action explains it`() {
        host.pair = Answer.Refused("unknown_action", "capture.pair")
        val outcome = Pairer(queue, pairings, host, TickingClock()::now).pair("https://x", "c", "d")
        assertTrue((outcome as PairOutcome.Failed).reason.contains("no capture.pair action"))
    }
}

class InterpretTest {
    @Test
    fun `kb receipts and HTTP statuses map to the four answers`() {
        assertEquals(Answer.Ok(FakeHost.ok("""{"nodeId":"n"}""").output), HttpCaptureHost.interpret(200, """{"status":"succeeded","id":"capture.submit","output":{"nodeId":"n"}}"""))
        assertEquals(Answer.Refused("invalid_input", "files[1]: too large"), HttpCaptureHost.interpret(200, """{"status":"failed","id":"capture.submit","code":"invalid_input","message":"files[1]: too large"}"""))
        assertTrue(HttpCaptureHost.interpret(200, """{"status":"failed","id":"x","code":"forbidden","message":"revoked"}""") is Answer.Unauthorized)
        assertTrue(HttpCaptureHost.interpret(200, """{"status":"failed","id":"x","code":"internal","message":"boom"}""") is Answer.Unreachable)
        assertEquals(Answer.Unauthorized("HTTP 401"), HttpCaptureHost.interpret(401, ""))
        assertEquals(
            Answer.Unauthorized("capture device credential is invalid or revoked"),
            HttpCaptureHost.interpret(403, """{"status":"failed","id":"kb.manifest","code":"forbidden","message":"capture device credential is invalid or revoked"}"""),
        )
        assertTrue(HttpCaptureHost.interpret(502, "Bad gateway") is Answer.Unreachable)
        assertTrue(HttpCaptureHost.interpret(200, "<html>") is Answer.Unreachable)
    }

    @Test
    fun `a host's own error and an unexpected status are kept as the detail of the reason`() {
        val internal = HttpCaptureHost.interpret(200, """{"status":"failed","id":"x","code":"internal","message":"boom"}""")
        assertEquals("it hit an error on its side (boom).", (internal as Answer.Unreachable).reason)
        assertEquals("its address answers, but not as kb (HTTP 200).", (HttpCaptureHost.interpret(200, "<html>") as Answer.Unreachable).reason)
    }

    @Test
    fun `a failed connection is classified by what failed`() {
        fun of(e: IOException) = HttpCaptureHost.noAnswer(e)
        assertEquals(NoAnswer.Dropped, of(IOException("unexpected end of stream on com.android.okhttp.Address@76c34e2c")))
        assertEquals(NoAnswer.Dropped, of(EOFException()))
        assertEquals(NoAnswer.Dropped, of(SocketException("Connection reset")))
        assertEquals(
            NoAnswer.Refused,
            of(ConnectException("failed to connect to /127.0.0.1 (port 47392) after 30000ms: isConnected failed: ECONNREFUSED (Connection refused)")),
        )
        assertEquals(
            NoAnswer.Offline,
            of(ConnectException("failed to connect to /10.0.2.2 (port 4321) after 30000ms: connect failed: ENETUNREACH (Network is unreachable)")),
        )
        assertEquals(NoAnswer.TimedOut, of(SocketTimeoutException("timeout")))
        assertEquals(NoAnswer.UnknownHost, of(UnknownHostException("Unable to resolve host \"kb.tail.ts.net\"")))
        assertEquals(NoAnswer.Untrusted, of(SSLHandshakeException("Trust anchor for certification path not found.")))
        assertEquals(NoAnswer.Network, of(IOException("something else")))
    }

    @Test
    fun `the manifest's capture contract may be one version or several`() {
        assertEquals(listOf(1), CaptureHost.acceptedContracts(FakeHost.ok("""{"captureContract":1}""").output))
        assertEquals(listOf(1, 2), CaptureHost.acceptedContracts(FakeHost.ok("""{"captureContract":[1,2]}""").output))
        assertEquals(emptyList<Int>(), CaptureHost.acceptedContracts(FakeHost.ok("""{"actions":[]}""").output))
    }
}
