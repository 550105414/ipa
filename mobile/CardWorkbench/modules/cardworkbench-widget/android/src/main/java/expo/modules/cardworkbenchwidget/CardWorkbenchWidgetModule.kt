package expo.modules.cardworkbenchwidget

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CardWorkbenchWidgetModule : Module() {
  private fun context(): Context = appContext.reactContext?.applicationContext
    ?: throw IllegalStateException("Widget application context is unavailable.")

  override fun definition() = ModuleDefinition {
    Name("CardWorkbenchWidget")

    AsyncFunction("updateSnapshot") { snapshotJson: String ->
      val context = context()
      TodoWidgetStore.save(context, snapshotJson)
      TodoWidgetProvider.updateAll(context)
    }

    Function("canScheduleExactAlarms") {
      val alarmManager = context().getSystemService(Context.ALARM_SERVICE) as AlarmManager
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
    }

    Function("openExactAlarmSettings") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        false
      } else {
        val context = context()
        try {
          context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          })
          true
        } catch (_: android.content.ActivityNotFoundException) {
          false
        } catch (_: SecurityException) {
          false
        }
      }
    }
  }
}
