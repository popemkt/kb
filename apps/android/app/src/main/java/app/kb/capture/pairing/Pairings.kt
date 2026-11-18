package app.kb.capture.pairing

import app.kb.capture.capture.PayloadWriter
import app.kb.capture.storage.Disk
import app.kb.capture.storage.RealDisk
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

/**
 * One store this phone may deliver to: where it is served, its stable key
 * and display name (from `capture.pair`), and the device credential, sealed by
 * [TokenVault]. [paused] says the host refused the credential (revoked or
 * wrong store); captures for this store wait until it is paired again.
 */
@Serializable
data class Pairing(
    val key: String,
    val name: String,
    val url: String,
    val sealedToken: String,
    val accepts: List<Int> = emptyList(),
    val paused: String? = null,
    val pairedAt: String,
)

/** Seals the device credential at rest. On a phone, an Android Keystore key ([KeystoreVault]). */
interface TokenVault {
    fun seal(token: String): String

    fun open(sealed: String): String
}

/**
 * The paired stores, newest first; the first is where new shares go. Kept as
 * one JSON file replaced by rename.
 *
 * off-graph: device-local — which stores this phone may deliver to, and its
 * credential for each, belong to the device, not to any store.
 */
class Pairings(private val file: File, private val vault: TokenVault, private val disk: Disk = RealDisk()) {
    private val lock = Any()
    private val _all = MutableStateFlow(load())

    val all: StateFlow<List<Pairing>> = _all.asStateFlow()

    /** Where a new share is pinned: the most recently paired store. */
    val current: Pairing?
        get() = _all.value.firstOrNull()

    fun byKey(key: String): Pairing? = _all.value.firstOrNull { it.key == key }

    fun token(pairing: Pairing): String = vault.open(pairing.sealedToken)

    /** Records a pairing; pairing a store again replaces its credential, clears a pause and makes it current. */
    fun save(key: String, name: String, url: String, token: String, accepts: List<Int>, at: String): Pairing =
        synchronized(lock) {
            val pairing = Pairing(key, name, url, vault.seal(token), accepts, paused = null, pairedAt = at)
            write(listOf(pairing) + _all.value.filter { it.key != key })
            pairing
        }

    fun update(key: String, change: (Pairing) -> Pairing) =
        synchronized(lock) { write(_all.value.map { if (it.key == key) change(it) else it }) }

    fun forget(key: String) = synchronized(lock) { write(_all.value.filter { it.key != key }) }

    private fun load(): List<Pairing> =
        try {
            if (disk.isFile(file)) PayloadWriter.json.decodeFromString(ListSerializer(Pairing.serializer()), disk.read(file).decodeToString()) else emptyList()
        } catch (_: Exception) {
            emptyList()
        }

    private fun write(next: List<Pairing>) {
        file.parentFile?.let { disk.mkdirs(it) }
        val tmp = File(file.path + ".tmp")
        disk.create(tmp) { it.write(PayloadWriter.json.encodeToString(ListSerializer(Pairing.serializer()), next).toByteArray()) }
        disk.rename(tmp, file)
        _all.value = next
    }
}
