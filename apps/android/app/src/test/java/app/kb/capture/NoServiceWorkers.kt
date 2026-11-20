package app.kb.capture

import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.ServiceWorkerWebSettings
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements

/**
 * Robolectric has no WebView provider, and Capacitor's bridge asks the
 * provider for the service-worker controller as it starts. This answers
 * with one that keeps nothing, which is all the shell's page needs: it
 * registers no service worker.
 */
@Implements(ServiceWorkerController::class)
class NoServiceWorkers {
    companion object {
        @JvmStatic
        @Implementation
        fun getInstance(): ServiceWorkerController = Controller

        private object Controller : ServiceWorkerController() {
            override fun getServiceWorkerWebSettings(): ServiceWorkerWebSettings = Settings

            override fun setServiceWorkerClient(client: ServiceWorkerClient?) = Unit
        }

        private object Settings : ServiceWorkerWebSettings() {
            override fun getAllowContentAccess() = false

            override fun getAllowFileAccess() = false

            override fun getBlockNetworkLoads() = false

            override fun getCacheMode() = 0

            override fun setAllowContentAccess(allow: Boolean) = Unit

            override fun setAllowFileAccess(allow: Boolean) = Unit

            override fun setBlockNetworkLoads(flag: Boolean) = Unit

            override fun setCacheMode(mode: Int) = Unit
        }
    }
}
