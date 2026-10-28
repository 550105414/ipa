package expo.modules.cardworkbenchwidget

import java.util.Calendar
import java.util.Locale

internal data class WidgetTask(
  val id: String,
  val title: String,
  val accent: String,
  val starred: Boolean,
  val dueAt: String?,
) {
  fun isVisible(now: Long): Boolean = dueAt == null ||
    TodoWidgetDates.parseDueAt(dueAt)?.let { it <= now } == true

  fun dueLabel(): String? = dueAt?.let { raw ->
    TodoWidgetDates.parseDueAt(raw)?.let { instant ->
      val date = Calendar.getInstance().apply { timeInMillis = instant }
      val day = "${date.get(Calendar.MONTH) + 1}月${date.get(Calendar.DAY_OF_MONTH)}日"
      if (raw.length == 10) day else String.format(
        Locale.CHINA, "%s %02d:%02d", day, date.get(Calendar.HOUR_OF_DAY), date.get(Calendar.MINUTE),
      )
    }
  }
}

internal data class WidgetSnapshot(val tasks: List<WidgetTask>, val syncState: String) {
  fun nextDueAfter(now: Long): Long? = tasks.mapNotNull { it.dueAt?.let(TodoWidgetDates::parseDueAt) }
    .filter { it > now }.minOrNull()
}
