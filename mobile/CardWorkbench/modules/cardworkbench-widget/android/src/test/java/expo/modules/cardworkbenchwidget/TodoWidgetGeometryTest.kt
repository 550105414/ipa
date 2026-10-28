package expo.modules.cardworkbenchwidget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.roundToInt

class TodoWidgetGeometryTest {
  @Test fun screenshotTallSlotProducesAnEqualSidedCenteredWhiteCard() {
    val square = TodoWidgetGeometry.square(TodoWidgetGeometry.Size(382f, 444f))
    assertEquals(382f, square.sideDp, 0f)
    assertEquals(0f, square.horizontalInsetDp, 0f)
    assertEquals(31f, square.verticalInsetDp, 0f)
    assertEquals(382, square.budgetSideDp)
    assertEquals(TodoWidgetGeometry.PixelInsets(0, 31, 0, 31),
      TodoWidgetGeometry.legacyInsets(TodoWidgetGeometry.Size(382f, 444f), 1f))
  }

  @Test fun landscapeWideSlotCentersTheSameSquareOnTheHorizontalAxis() {
    val square = TodoWidgetGeometry.square(TodoWidgetGeometry.Size(444f, 382f))
    assertEquals(382f, square.sideDp, 0f)
    assertEquals(31f, square.horizontalInsetDp, 0f)
    assertEquals(0f, square.verticalInsetDp, 0f)
  }

  @Test fun fractionalExactSizesUseOneSideAndRoundBudgetDown() {
    val square = TodoWidgetGeometry.square(TodoWidgetGeometry.Size(152.8f, 177.6f))
    assertEquals(152.8f, square.sideDp, 0f)
    assertEquals(12.4f, square.verticalInsetDp, 0.001f)
    assertEquals(152, square.budgetSideDp)
  }

  @Test fun legacyPixelPaddingPreservesSquareEvenWithFractionalDensity() {
    val size = TodoWidgetGeometry.Size(152.8f, 177.6f)
    val density = 2.625f
    val insets = TodoWidgetGeometry.legacyInsets(size, density)
    val width = (size.widthDp * density).roundToInt() - insets.left - insets.right
    val height = (size.heightDp * density).roundToInt() - insets.top - insets.bottom
    assertEquals(width, height)
    assertTrue(kotlin.math.abs(insets.top - insets.bottom) <= 1)
    assertEquals(insets.left, insets.right)
  }

  @Test fun oddPixelDifferencesAreSplitWithoutStretchingOrLosingAPixel() {
    val insets = TodoWidgetGeometry.legacyInsets(TodoWidgetGeometry.Size(151f, 180f), 1f)
    assertEquals(TodoWidgetGeometry.PixelInsets(0, 14, 0, 15), insets)
    assertEquals(151, 180 - insets.top - insets.bottom)
  }

  @Test fun missingExactSizesFallbackPairsActualPortraitAndLandscapeRanges() {
    val sizes = TodoWidgetGeometry.fallback(160, 130, 230, 220)
    assertEquals(TodoWidgetGeometry.Size(160f, 220f), sizes.portrait)
    assertEquals(TodoWidgetGeometry.Size(230f, 130f), sizes.landscape)
    assertFalse(sizes.portrait == TodoWidgetGeometry.Size(160f, 130f))
    assertEquals(160f, TodoWidgetGeometry.square(sizes.portrait).sideDp, 0f)
    assertEquals(130f, TodoWidgetGeometry.square(sizes.landscape).sideDp, 0f)
  }

  @Test fun absentPartialAndReversedOptionsHaveDeterministicSafeFallbacks() {
    val missing = TodoWidgetGeometry.fallback(0, 0, 0, 0)
    assertEquals(TodoWidgetGeometry.Size(160f, 160f), missing.portrait)
    assertEquals(missing.portrait, missing.landscape)
    val partial = TodoWidgetGeometry.fallback(150, 0, 0, 180)
    assertEquals(TodoWidgetGeometry.Size(150f, 180f), partial.portrait)
    assertEquals(partial.portrait, partial.landscape)
    val reversed = TodoWidgetGeometry.fallback(180, 220, 110, 130)
    assertEquals(TodoWidgetGeometry.Size(110f, 220f), reversed.portrait)
    assertEquals(TodoWidgetGeometry.Size(180f, 130f), reversed.landscape)
  }

  @Test fun exactSizesRejectInvalidValuesAndDeduplicateBeforeTheSixteenLayoutLimit() {
    val sizes = mutableListOf(
      TodoWidgetGeometry.Size(Float.NaN, 160f), TodoWidgetGeometry.Size(160f, Float.POSITIVE_INFINITY),
      TodoWidgetGeometry.Size(0f, 160f), TodoWidgetGeometry.Size(160f, -1f),
      TodoWidgetGeometry.Size(160f, 180f), TodoWidgetGeometry.Size(160f, 180f),
    )
    sizes += (1..20).map { TodoWidgetGeometry.Size(200f + it, 230f) }
    val before = sizes.toList()
    val exact = TodoWidgetGeometry.exactSizes(sizes)
    assertEquals(16, exact.size)
    assertEquals(TodoWidgetGeometry.Size(160f, 180f), exact.first())
    assertEquals(16, exact.toSet().size)
    assertTrue(exact.all { it.isValid })
    assertEquals(before, sizes)
    assertTrue(TodoWidgetGeometry.exactSizes(emptyList()).isEmpty())
  }

  @Test fun rowBudgetUsesSquareSideNotTheTallerSlotIncludingLargeFonts() {
    val size = TodoWidgetGeometry.Size(160f, 220f)
    val square = TodoWidgetGeometry.square(size)
    val dates = List(8) { true }
    val normal = TodoWidgetLayout.plan(square.budgetSideDp, 1f, dates)
    assertEquals(2, normal.visibleCount)
    assertTrue(TodoWidgetLayout.plan(size.heightDp.toInt(), 1f, dates).visibleCount > normal.visibleCount)
    val enlarged = TodoWidgetLayout.plan(square.budgetSideDp, 2f, dates)
    assertTrue(enlarged.visibleCount < normal.visibleCount)
    assertEquals(dates.size, enlarged.visibleCount + enlarged.remainingCount)
  }
}
