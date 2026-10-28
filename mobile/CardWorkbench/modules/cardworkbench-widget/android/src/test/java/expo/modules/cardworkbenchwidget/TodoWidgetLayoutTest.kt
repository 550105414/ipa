package expo.modules.cardworkbenchwidget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TodoWidgetLayoutTest {
  @Test fun narrowHeaderKeepsLabelReadableWithLargeFontsAndThreeDigitCounts() {
    assertTrue(TodoWidgetLayout.showHeaderCount(110, 1f, 9))
    assertFalse(TodoWidgetLayout.showHeaderCount(150, 2f, 100))
    assertTrue(TodoWidgetLayout.showHeaderCount(160, 2f, 100))
    assertFalse(TodoWidgetLayout.showHeaderIcon(149, 1f))
    assertFalse(TodoWidgetLayout.showHeaderIcon(160, 2f))
    assertTrue(TodoWidgetLayout.showHeaderIcon(160, 1f))
  }

  @Test fun typicalTwoByTwoShowsTwoDatedRowsAndKeepsRemainder() {
    val layout = TodoWidgetLayout.plan(160, 1f, List(7) { true })
    assertEquals(2, layout.visibleCount)
    assertEquals(5, layout.remainingCount)
    assertTrue(layout.showFooter)
  }

  @Test fun threeUndatedRowsFitWithoutAnUnnecessaryFooter() {
    val layout = TodoWidgetLayout.plan(160, 1f, List(3) { false })
    assertEquals(3, layout.visibleCount)
    assertEquals(0, layout.remainingCount)
    assertFalse(layout.showFooter)
  }

  @Test fun leavesSpaceForMoreCountInsteadOfClippingLastRow() {
    val layout = TodoWidgetLayout.plan(160, 1f, List(4) { false })
    assertEquals(2, layout.visibleCount)
    assertEquals(2, layout.remainingCount)
    assertTrue(layout.showFooter)
  }

  @Test fun minimumSizeDoesNotForceTheFirstDatedRowIntoTheFooter() {
    val layout = TodoWidgetLayout.plan(110, 1f, List(4) { true })
    assertEquals(0, layout.visibleCount)
    assertEquals(4, layout.remainingCount)
    assertFalse(layout.showFooter)
  }

  @Test fun largeFontsReduceRowsAndEmptyHintLines() {
    val normal = TodoWidgetLayout.plan(160, 1f, List(7) { true })
    val enlarged = TodoWidgetLayout.plan(160, 2f, List(7) { true })
    assertTrue(enlarged.visibleCount < normal.visibleCount)
    assertEquals(1, TodoWidgetLayout.plan(110, 2f, emptyList()).emptyMaxLines)
    assertEquals(2, TodoWidgetLayout.plan(160, 1f, emptyList()).emptyMaxLines)
  }

  @Test fun expandingGivesMoreRowsButNeverMutatesInputOrLosesCount() {
    val dates = MutableList(40) { it % 2 == 0 }
    val before = dates.toList()
    var previous = 0
    for (height in 110..500) {
      val layout = TodoWidgetLayout.plan(height, 1f, dates)
      assertTrue(layout.visibleCount >= previous)
      assertTrue(layout.visibleCount in 0..6)
      assertEquals(dates.size, layout.visibleCount + layout.remainingCount)
      previous = layout.visibleCount
    }
    assertEquals(before, dates)
    assertEquals(6, previous)
  }

  @Test fun emptyOrInvalidMeasurementsCannotCreatePhantomRows() {
    assertEquals(0, TodoWidgetLayout.plan(0, 1f, List(3) { false }).visibleCount)
    assertEquals(0, TodoWidgetLayout.plan(-1, 2f, List(3) { true }).visibleCount)
    assertEquals(0, TodoWidgetLayout.plan(160, 1f, emptyList()).remainingCount)
    assertEquals(
      TodoWidgetLayout.plan(160, 1f, List(3) { false }),
      TodoWidgetLayout.plan(160, Float.NaN, List(3) { false }),
    )
  }
}
