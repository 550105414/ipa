package expo.modules.cardworkbenchwidget

import kotlin.math.ceil

/** Conservative dp budget for the compact RemoteViews XML, without Android dependencies. */
internal object TodoWidgetLayout {
  private const val MAX_ROWS = 6
  private const val PADDING = 12f
  private const val ROW_GAP = 4f
  private const val LINE_HEIGHT = 1.35f

  internal data class Plan(
    val visibleCount: Int,
    val remainingCount: Int,
    val showFooter: Boolean,
    val emptyMaxLines: Int,
  )

  fun showHeaderIcon(widthDp: Int, fontScale: Float): Boolean = widthDp >= 150 && fontScale <= 1.3f

  fun showHeaderCount(widthDp: Int, fontScale: Float, count: Int): Boolean {
    val scale = safeScale(fontScale)
    val countWidth = (count.toString().length * 12f * scale + 12f).coerceIn(26f, 48f)
    val iconWidth = if (showHeaderIcon(widthDp, scale)) 18f else 0f
    // Allow two full-width Chinese characters, both margins, and the badge.
    return widthDp - PADDING * 2 >= 36f * scale + 9f + countWidth + iconWidth
  }

  fun plan(heightDp: Int, fontScale: Float, hasDates: List<Boolean>): Plan {
    // Use the full configured multiplier conservatively for these small text sizes.
    val scale = safeScale(fontScale)
    val header = ceil(maxOf(26f, line(18f, scale), line(12f, scale) + 6f))
    val available = (heightDp - PADDING * 2 - header - ROW_GAP).coerceAtLeast(0f)
    val heights = hasDates.take(MAX_ROWS).map { hasDate ->
      val text = line(14f, scale) + if (hasDate) 2f + line(10f, scale) else 0f
      ceil(8f + maxOf(text, line(18f, scale)))
    }
    val allFit = hasDates.size <= MAX_ROWS && heights.sum() <= available
    val footer = if (allFit) 0f else ceil(4f + line(10f, scale))
    var used = 0f
    var visible = 0
    for (height in heights) {
      // Never force even the first row into insufficient space.
      if (used + height + footer > available) break
      used += height
      visible++
    }
    return Plan(
      visibleCount = visible,
      remainingCount = hasDates.size - visible,
      showFooter = visible > 0 && visible < hasDates.size,
      emptyMaxLines = if (available >= line(12f, scale) * 2) 2 else 1,
    )
  }

  private fun line(sizeSp: Float, scale: Float): Float = sizeSp * LINE_HEIGHT * scale

  private fun safeScale(fontScale: Float): Float = if (fontScale.isFinite()) fontScale.coerceAtLeast(1f) else 1f
}
