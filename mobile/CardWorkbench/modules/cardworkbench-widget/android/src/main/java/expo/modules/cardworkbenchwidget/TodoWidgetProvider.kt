package expo.modules.cardworkbenchwidget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews

class TodoWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = updateAll(context)

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    updateAll(context)
  }

  override fun onDisabled(context: Context) = TodoWidgetAlarms.cancel(context)

  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    if (widgetIds(context).isEmpty()) TodoWidgetAlarms.cancel(context)
  }

  companion object {
    private fun widgetIds(context: Context): IntArray = AppWidgetManager.getInstance(context)
      .getAppWidgetIds(ComponentName(context, TodoWidgetProvider::class.java))

    @Synchronized
    fun updateAll(context: Context) {
      val ids = widgetIds(context)
      if (ids.isEmpty()) {
        TodoWidgetAlarms.cancel(context)
        return
      }
      val snapshot = TodoWidgetStore.load(context)
      val now = System.currentTimeMillis()
      val tasks = snapshot?.tasks.orEmpty().filter { it.isVisible(now) }
      val manager = AppWidgetManager.getInstance(context)
      ids.forEach { id ->
        val views = RemoteViews(context.packageName, R.layout.cardworkbench_widget)
        views.setOnClickPendingIntent(R.id.cardworkbench_widget_root, openApp(context, null))
        views.setTextViewText(R.id.cardworkbench_widget_count, tasks.size.toString())
        views.removeAllViews(R.id.cardworkbench_widget_rows)
        val height = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 180)
        val fontScale = context.resources.configuration.fontScale.coerceAtLeast(1f)
        var rowSpace = height - 44 - 54 * fontScale
        var limit = 0
        for (task in tasks.take(6)) {
          val textHeight = if (task.dueAt == null) 16 * fontScale else 28 * fontScale + 3
          val rowHeight = 14 + maxOf(25 * fontScale, textHeight)
          if (limit > 0 && rowSpace < rowHeight) break
          limit++
          rowSpace -= rowHeight
        }
        tasks.take(limit).forEach { task ->
          val row = RemoteViews(context.packageName, R.layout.cardworkbench_widget_row)
          row.setTextViewText(R.id.cardworkbench_widget_task_title, task.title)
          row.setTextColor(R.id.cardworkbench_widget_task_circle, accent(task.accent))
          row.setTextViewText(R.id.cardworkbench_widget_task_star, if (task.starred) "★" else "")
          val due = task.dueLabel()
          row.setTextViewText(R.id.cardworkbench_widget_task_date, due.orEmpty())
          row.setViewVisibility(R.id.cardworkbench_widget_task_date, if (due == null) View.GONE else View.VISIBLE)
          row.setOnClickPendingIntent(R.id.cardworkbench_widget_task_row, openApp(context, task.id))
          views.addView(R.id.cardworkbench_widget_rows, row)
        }
        val empty = when {
          snapshot == null -> "打开工作台同步待办"
          tasks.isNotEmpty() -> ""
          snapshot.tasks.any { it.dueAt != null } -> "暂无已到时间的待办\n到时会在这里显示"
          snapshot.syncState == "unpaired" -> "打开工作台添加待办"
          else -> "全部完成啦\n点击添加新的待办"
        }
        views.setTextViewText(R.id.cardworkbench_widget_empty, empty)
        views.setViewVisibility(R.id.cardworkbench_widget_empty, if (tasks.isEmpty()) View.VISIBLE else View.GONE)
        views.setTextViewText(R.id.cardworkbench_widget_footer, if (tasks.size > limit) "还有 ${tasks.size - limit} 项 · 点击查看" else "点击打开工作台")
        manager.updateAppWidget(id, views)
      }
      TodoWidgetAlarms.schedule(context, snapshot, now)
    }

    private fun accent(raw: String): Int = try {
      Color.parseColor(raw)
    } catch (_: IllegalArgumentException) {
      Color.rgb(59, 120, 185)
    }

    private fun openApp(context: Context, taskId: String?): PendingIntent {
      val uri = Uri.Builder().scheme("cardworkbench")
        .authority(if (taskId != null && taskId.matches(Regex("[1-9]\\d*"))) "add-task" else "plan")
      if (taskId != null && taskId.matches(Regex("[1-9]\\d*"))) uri.appendQueryParameter("task", taskId)
      val intent = Intent(Intent.ACTION_VIEW, uri.build()).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      // The URI is part of PendingIntent identity, so different task rows do
      // not overwrite one another's destination even with a common requestCode.
      return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
  }
}

class TodoWidgetRefreshReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    // No extras or external snapshots are accepted. Read only app-private data.
    TodoWidgetProvider.updateAll(context)
  }
}

internal object TodoWidgetAlarms {
  private const val REQUEST_CODE = 94271

  private fun operation(context: Context): PendingIntent = PendingIntent.getBroadcast(
    context,
    REQUEST_CODE,
    Intent(context, TodoWidgetRefreshReceiver::class.java).setAction("${context.packageName}.WIDGET_DUE"),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )

  fun cancel(context: Context) {
    (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(operation(context))
  }

  fun schedule(context: Context, snapshot: WidgetSnapshot?, now: Long) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pending = operation(context)
    val next = snapshot?.nextDueAfter(now)
    manager.cancel(pending)
    if (next == null) return
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()) {
        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
      } else {
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
      }
    } catch (_: SecurityException) {
      // The permission may be revoked between canScheduleExactAlarms and set.
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
    }
  }
}
