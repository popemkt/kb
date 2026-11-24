package app.kb.capture

import app.kb.capture.pairing.Pairing
import app.kb.capture.shell.Back
import app.kb.capture.shell.PairLink
import app.kb.capture.shell.Pane
import app.kb.capture.shell.Routes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutesTest {
    private fun store(key: String, url: String) = Pairing(key, key.replaceFirstChar { it.uppercase() }, url, "sealed", listOf(1), pairedAt = "2026-11-20T08:00:00.000+07:00")

    private val personal = store("personal", "https://kb.tail.ts.net")
    private val work = store("work", "http://100.64.0.2:4321")
    private val stores = listOf(personal, work)

    @Test
    fun `a launch opens the current store's own UI, and Stores when nothing is paired`() {
        assertEquals("https://kb.tail.ts.net/", Routes.forLink(null, personal))
        assertEquals(Routes.STORES, Routes.forLink(null, null))
    }

    @Test
    fun `kb links open the shell's views or a path of the store's own UI`() {
        assertEquals(Routes.CAPTURE, Routes.forLink("kb://capture", personal))
        assertEquals(Routes.QUEUE, Routes.forLink("kb://queue", personal))
        assertEquals(Routes.STORES, Routes.forLink("kb://stores", personal))
        assertEquals("https://kb.tail.ts.net/n/01ABC?view=table#top", Routes.forLink("kb://open/n/01ABC?view=table#top", personal))
        assertEquals("https://kb.tail.ts.net/", Routes.forLink("kb://open", personal))
        assertEquals(Routes.STORES, Routes.forLink("kb://open/n/01ABC", null))
        assertEquals(Routes.STORES, Routes.forLink("https://evil.example/", personal))
    }

    @Test
    fun `a page belongs to the store whose origin it shares, default ports included`() {
        assertEquals(personal, Routes.storeOf("https://kb.tail.ts.net:443/n/x", stores))
        assertEquals(work, Routes.storeOf("http://100.64.0.2:4321/", stores))
        assertNull(Routes.storeOf("http://100.64.0.2:4322/", stores))
        assertNull(Routes.storeOf("https://kb.tail.ts.net.evil.example/", stores))
        assertTrue(Routes.isShell("https://localhost/#/queue"))
        assertFalse(Routes.isShell("http://localhost:4321/"))
    }

    @Test
    fun `the shell's page, a paired store's UI and anything else each have their own pane`() {
        assertEquals(Pane.Shell, Routes.paneFor("https://localhost/#/stores", stores))
        assertEquals(Pane.Store, Routes.paneFor("https://kb.tail.ts.net/n/01ABC", stores))
        assertEquals(Pane.Store, Routes.paneFor("http://100.64.0.2:4321/", stores))
        assertEquals(Pane.Outside, Routes.paneFor("https://example.com/article", stores))
        assertEquals(Pane.Outside, Routes.paneFor("http://localhost:4321/", stores))
        assertEquals(Pane.Outside, Routes.paneFor(null, stores))
    }

    @Test
    fun `only the shell page's own views count as the shell, nothing else on its origin`() {
        for (view in listOf("https://localhost", "https://localhost/", "https://localhost/#/", Routes.STORES, Routes.QUEUE, Routes.CAPTURE, Routes.offline(personal, "timeout"))) {
            assertEquals(view, Pane.Shell, Routes.paneFor(view, stores))
        }
        for (other in listOf(
            "https://localhost/_capacitor_file_/data/user/0/app.kb.capture/files/pairings.json",
            "https://localhost/_capacitor_content_/x",
            "https://localhost/shell.js",
            "https://localhost/index.html#/stores",
            "https://localhost/?x=1#/stores",
            "https://localhost/#/elsewhere",
            "https://localhost:443/#/../_capacitor_file_/x",
        )) {
            assertEquals(other, Pane.Nowhere, Routes.paneFor(other, stores))
        }
    }

    @Test
    fun `back walks the store's own history, then Stores, then leaves`() {
        assertEquals(Back.GoBack, Routes.back("https://kb.tail.ts.net/n/b", "https://kb.tail.ts.net/n/a", stores))
        assertEquals(Back.Load(Routes.STORES), Routes.back("https://kb.tail.ts.net/", Routes.STORES, stores))
        assertEquals(Back.Load(Routes.STORES), Routes.back("https://kb.tail.ts.net/", null, stores))
        assertEquals(Back.Load(Routes.STORES), Routes.back("https://kb.tail.ts.net/", "http://100.64.0.2:4321/", stores))
        assertEquals(Back.Load(Routes.STORES), Routes.back(Routes.CAPTURE, Routes.STORES, stores))
        assertEquals(Back.Load(Routes.STORES), Routes.back(Routes.offline(personal, "timeout"), "https://kb.tail.ts.net/", stores))
        assertEquals(Back.Leave, Routes.back(Routes.STORES, "https://kb.tail.ts.net/", stores))
    }

    @Test
    fun `the offline view names the store and why, encoded for the fragment`() {
        assertEquals("https://localhost/#/queue?offline=Personal&why=net%3A%3AERR_ADDRESS_UNREACHABLE", Routes.offline(personal, "net::ERR_ADDRESS_UNREACHABLE"))
    }

    @Test
    fun `pair links validate origin and 32-char hex code, allowing http only when enabled`() {
        val code = "0123456789abcdef0123456789abcdef"
        val upper = "0123456789ABCDEF0123456789ABCDEF"
        assertEquals(
            PairLink("https://kb.tail.ts.net", code),
            Routes.parsePairLink("kb://pair?url=https%3A%2F%2FKB.Tail.ts.net%2F&code=$upper", allowHttp = false),
        )
        assertEquals(
            PairLink("https://kb.tail.ts.net:8443", code),
            Routes.parsePairLink("kb://pair?url=https%3A%2F%2Fkb.tail.ts.net%3A8443&code=$code", allowHttp = false),
        )
        assertNull(Routes.parsePairLink("kb://pair?url=http%3A%2F%2F127.0.0.1%3A4321&code=$code", allowHttp = false))
        assertEquals(
            PairLink("http://127.0.0.1:4321", code),
            Routes.parsePairLink("kb://pair?url=http%3A%2F%2F127.0.0.1%3A4321&code=$code", allowHttp = true),
        )
        for (bad in listOf(
            null,
            "",
            "https://kb.tail.ts.net/?url=https%3A%2F%2Fkb.tail.ts.net&code=$code",
            "kb://stores?url=https%3A%2F%2Fkb.tail.ts.net&code=$code",
            "kb://pair/extra?url=https%3A%2F%2Fkb.tail.ts.net&code=$code",
            "kb://pair?url=https%3A%2F%2Fkb.tail.ts.net",
            "kb://pair?code=$code",
            "kb://pair?url=https%3A%2F%2Fkb.tail.ts.net&code=short",
            "kb://pair?url=https%3A%2F%2Fkb.tail.ts.net&code=${code}0",
            "kb://pair?url=https%3A%2F%2Fkb.tail.ts.net&code=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
            "kb://pair?url=javascript%3Aalert(1)&code=$code",
            "kb://pair?url=https%3A%2F%2Fuser%3Apass%40kb.tail.ts.net&code=$code",
            "kb://pair?url=https%3A%2F%2Fkb.tail.ts.net%2Fpath&code=$code",
            "kb://pair?url=https%3A%2F%2Fkb.tail.ts.net%3Fx%3D1&code=$code",
            "kb://pair?url=https%3A%2F%2Fkb.tail.ts.net%23frag&code=$code",
        )) {
            assertNull(bad ?: "null", Routes.parsePairLink(bad, allowHttp = true))
        }
    }

    @Test
    fun `valid pair links route to the shell's Stores view prefilled, invalid ones fall back to Stores`() {
        val code = "0123456789abcdef0123456789abcdef"
        val valid = Routes.forLink("kb://pair?url=https%3A%2F%2Fkb.tail.ts.net&code=$code", personal, allowHttp = false)
        assertEquals("https://localhost/#/stores?url=https%3A%2F%2Fkb.tail.ts.net&code=$code", valid)
        assertEquals(Pane.Shell, Routes.paneFor(valid, stores))
        assertEquals(Back.Load(Routes.STORES), Routes.back(valid, null, stores))
        assertEquals(Routes.STORES, Routes.forLink("kb://pair?url=http%3A%2F%2F127.0.0.1%3A4321&code=$code", personal, allowHttp = false))
        assertEquals(
            "https://localhost/#/stores?url=http%3A%2F%2F127.0.0.1%3A4321&code=$code",
            Routes.forLink("kb://pair?url=http%3A%2F%2F127.0.0.1%3A4321&code=$code", personal, allowHttp = true),
        )
        assertEquals(Routes.STORES, Routes.forLink("kb://pair?url=https%3A%2F%2Fkb.tail.ts.net&code=not-hex", personal, allowHttp = true))
    }
}
