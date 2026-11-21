package app.kb.capture.device

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews
import app.kb.capture.R

/** The home-screen widget: one tap opens Capture ([CaptureLink]). */
class CaptureWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val views = RemoteViews(context.packageName, R.layout.capture_widget)
        views.setOnClickPendingIntent(R.id.capture_widget, CaptureLink.pending(context))
        manager.updateAppWidget(ids, views)
    }
}
