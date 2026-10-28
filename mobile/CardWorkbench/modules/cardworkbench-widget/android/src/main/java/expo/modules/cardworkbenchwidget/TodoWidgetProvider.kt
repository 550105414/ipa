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
import android.os.Parcelable
import android.util.SizeF
import android.util.TypedValue
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
        val options = manager.getAppWidgetOptions(id)
        manager.updateAppWidget(id, adaptiveViews(context, options, snapshot, tasks))
      }
      TodoWidgetAlarms.schedule(context, snapshot, now)
    }

    private fun adaptiveViews(context: Context, options: Bundle, snapshot: WidgetSnapshot?, tasks: List<WidgetTask>): RemoteViews {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val exact = exactSizes(options)
        if (exact.isNotEmpty()) {
          return RemoteViews(exact.associate { size ->
            SizeF(size.widthDp, size.heightDp) to sizedViews(context, snapshot, tasks, size)
          })
        }
      }
      // These launcher dimensions already exclude default host padding. Do not subtract it twice.
      val sizes = TodoWidgetGeometry.fallback(
        options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH),
        options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT),
        options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH),
        options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT),
      )
      val portrait = sizedViews(context, snapshot, tasks, sizes.portrait)
      return if (sizes.landscape == sizes.portrait) portrait
        else RemoteViews(sizedViews(context, snapshot, tasks, sizes.landscape), portrait)
    }

    @Suppress("DEPRECATION")
    private fun exactSizes(options: Bundle): List<TodoWidgetGeometry.Size> {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return emptyList()
      val sizes = try {
        options.getParcelableArrayList<Parcelable>(AppWidgetManager.OPTION_APPWIDGET_SIZES).orEmpty()
      } catch (_: RuntimeException) {
        emptyList()
      }
      return TodoWidgetGeometry.exactSizes(sizes.mapNotNull { value ->
        (value as? SizeF)?.let { TodoWidgetGeometry.Size(it.width, it.height) }
      })
    }

    private fun sizedViews(context: Context, snapshot: WidgetSnapshot?, tasks: List<WidgetTask>, size: TodoWidgetGeometry.Size): RemoteViews {
      val square = TodoWidgetGeometry.square(size)
      val views = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        RemoteViews(context.packageName, R.layout.cardworkbench_widget).apply {
          setViewLayoutWidth(R.id.cardworkbench_widget_card, square.sideDp, TypedValue.COMPLEX_UNIT_DIP)
          setViewLayoutHeight(R.id.cardworkbench_widget_card, square.sideDp, TypedValue.COMPLEX_UNIT_DIP)
        }
      } else {
        val inset = TodoWidgetGeometry.legacyInsets(size, context.resources.displayMetrics.density)
        RemoteViews(context.packageName, R.layout.cardworkbench_widget_legacy).apply {
          setViewPadding(R.id.cardworkbench_widget_root, inset.left, inset.top, inset.right, inset.bottom)
        }
      }
      views.setOnClickPendingIntent(R.id.cardworkbench_widget_root, openApp(context, null))
      views.setTextViewText(R.id.cardworkbench_widget_count, tasks.size.toString())
      views.setContentDescription(R.id.cardworkbench_widget_count, "已到时间，共 ${tasks.size} 项待办")
      views.removeAllViews(R.id.cardworkbench_widget_rows)
      val side = square.budgetSideDp
      val fontScale = context.resources.configuration.fontScale.coerceAtLeast(1f)
      val layout = TodoWidgetLayout.plan(side, fontScale, tasks.map { it.dueAt != null })
      // Both text width and row height use the square card, never the taller launcher slot.
      views.setViewVisibility(R.id.cardworkbench_widget_icon, if (TodoWidgetLayout.showHeaderIcon(side, fontScale)) View.VISIBLE else View.GONE)
      views.setViewVisibility(R.id.cardworkbench_widget_count, if (TodoWidgetLayout.showHeaderCount(side, fontScale, tasks.size)) View.VISIBLE else View.GONE)
      views.setContentDescription(R.id.cardworkbench_widget_root, "全部待办，已到时间 ${tasks.size} 项，点击查看")
      tasks.take(layout.visibleCount).forEach { task ->
        val row = RemoteViews(context.packageName, R.layout.cardworkbench_widget_row)
        row.setTextViewText(R.id.cardworkbench_widget_task_title, task.title)
        row.setTextColor(R.id.cardworkbench_widget_task_circle, accent(task.accent))
        row.setViewVisibility(R.id.cardworkbench_widget_task_circle, if (side < 150 && fontScale > 1.3f) View.GONE else View.VISIBLE)
        row.setTextViewText(R.id.cardworkbench_widget_task_star, if (task.starred) "★" else "")
        row.setViewVisibility(R.id.cardworkbench_widget_task_star, if (task.starred) View.VISIBLE else View.GONE)
        val due = task.dueLabel()
        row.setTextViewText(R.id.cardworkbench_widget_task_date, due.orEmpty())
        row.setViewVisibility(R.id.cardworkbench_widget_task_date, if (due == null) View.GONE else View.VISIBLE)
        row.setOnClickPendingIntent(R.id.cardworkbench_widget_task_row, openApp(context, task.id))
        views.addView(R.id.cardworkbench_widget_rows, row)
      }
      val empty = when {
        snapshot == null -> "打开工作台同步待办"
        tasks.isNotEmpty() -> "点击查看 ${tasks.size} 项待办"
        snapshot.tasks.any { it.dueAt != null } -> "暂无到期待办\n到时自动显示"
        snapshot.syncState == "unpaired" -> "打开工作台添加待办"
        else -> "全部完成啦\n点击添加新的待办"
      }
      views.setTextViewText(R.id.cardworkbench_widget_empty, empty)
      views.setInt(R.id.cardworkbench_widget_empty, "setMaxLines", layout.emptyMaxLines)
      views.setViewVisibility(R.id.cardworkbench_widget_empty, if (layout.visibleCount == 0) View.VISIBLE else View.GONE)
      views.setTextViewText(R.id.cardworkbench_widget_footer, "还有 ${layout.remainingCount} 项 · 点击查看")
      views.setViewVisibility(R.id.cardworkbench_widget_footer, if (layout.showFooter) View.VISIBLE else View.GONE)
      return views
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
