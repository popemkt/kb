package app.kb.capture

import app.kb.capture.pairing.Pairing
import app.kb.capture.shell.Back
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
}
