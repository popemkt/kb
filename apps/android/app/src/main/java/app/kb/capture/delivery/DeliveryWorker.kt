package app.kb.capture.delivery

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.kb.capture.KbCapture
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Runs [Deliverer] in the background once the phone has a network, and again
 * with exponential backoff while something is left to deliver. WorkManager
 * keeps the request across reboots, so a share made offline goes out when
 * the tailnet is back, best effort.
 */
class DeliveryWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result =
        withContext(Dispatchers.IO) {
            if (KbCapture.of(applicationContext).deliverer.deliverAll(keepGoing = { !isStopped })) Result.retry() else Result.success()
        }

    companion object {
        private const val NAME = "kb-capture-delivery"

        /**
         * Starts a delivery run now (or when the network returns). A run in
         * progress is replaced: the host is idempotent on `captureId`, so a
         * capture cut off mid-send is sent again, never twice.
         */
        fun schedule(context: Context) {
            val request =
                OneTimeWorkRequestBuilder<DeliveryWorker>()
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
