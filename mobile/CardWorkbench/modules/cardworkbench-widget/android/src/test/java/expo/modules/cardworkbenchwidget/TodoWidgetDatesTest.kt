package expo.modules.cardworkbenchwidget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

class TodoWidgetDatesTest {
  private fun task(dueAt: String?) = WidgetTask("1", "待办", "#123456", true, dueAt)

  @Test fun preservesTimestampAndOffsets() {
    assertEquals(1793183400000L, TodoWidgetDates.parseDueAt("2026-10-28T18:30:00+08:00"))
    assertEquals(TodoWidgetDates.parseDueAt("2026-10-28T10:30:00Z"), TodoWidgetDates.parseDueAt("2026-10-28T03:30:00-07:00"))
    assertEquals(1793183400120L, TodoWidgetDates.parseDueAt("2026-10-28T10:30:00.12Z"))
  }

  @Test fun dateOnlyIsLocalMidnightNotUtcOrNineAmReminderTime() {
    val previous = TimeZone.getDefault()
    try {
      TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"))
      assertEquals(TodoWidgetDates.parseDueAt("2026-10-28T00:00:00+08:00"), TodoWidgetDates.parseDueAt("2026-10-28"))
      TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))
      assertEquals(TodoWidgetDates.parseDueAt("2026-10-28T00:00:00-07:00"), TodoWidgetDates.parseDueAt("2026-10-28"))
    } finally {
      TimeZone.setDefault(previous)
    }
  }

  @Test fun doesNotNormalizeMalformedDatesIntoVisibleTasks() {
    listOf("", "bad", "2026-02-30", "2026-02-29", "2026-13-01", "2026-10-28T24:00", "2026-10-28T09:60", "2026-10-28T10:30:00+24:00", "0000-01-01")
      .forEach { assertNull(it, TodoWidgetDates.parseDueAt(it)) }
  }

  @Test fun rejectsMissingDstHourAndAcceptsLeapDay() {
    val previous = TimeZone.getDefault()
    try {
      TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))
      assertNull(TodoWidgetDates.parseDueAt("2026-03-08T02:30"))
      assertEquals(TodoWidgetDates.parseDueAt("2028-02-29T00:00:00-08:00"), TodoWidgetDates.parseDueAt("2028-02-29"))
    } finally {
      TimeZone.setDefault(previous)
    }
  }
  @Test fun revealsAtExactBoundaryAndNeverRevealsMalformedScheduledTask() {
    val due = "2026-10-28T18:30:00+08:00"
    val instant = TodoWidgetDates.parseDueAt(due)!!
    assertFalse(task(due).isVisible(instant - 1))
    assertTrue(task(due).isVisible(instant))
    assertTrue(task(due).isVisible(instant + 1))
    assertFalse(task("2026-02-30").isVisible(instant))
    assertTrue(task(null).isVisible(instant))
  }

  @Test fun alarmTargetsNextFutureDateAndCanAdvanceWithoutOpeningApp() {
    val first = TodoWidgetDates.parseDueAt("2026-10-28T10:00:00Z")!!
    val second = TodoWidgetDates.parseDueAt("2026-10-28T11:00:00Z")!!
    val snapshot = WidgetSnapshot(listOf(task(null), task("bad"), task("2026-10-28T11:00:00Z"), task("2026-10-28T10:00:00Z")), "ready")
    assertEquals(first, snapshot.nextDueAfter(first - 1))
    assertEquals(second, snapshot.nextDueAfter(first))
    assertNull(snapshot.nextDueAfter(second))
  }
}
