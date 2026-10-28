package expo.modules.cardworkbenchwidget

import kotlin.math.floor
import kotlin.math.roundToInt

/** The launcher slot is not necessarily square even when it occupies 2 x 2 cells. */
internal object TodoWidgetGeometry {
  private const val FALLBACK_SIDE_DP = 160f
  private const val MAX_EXACT_SIZES = 16

  data class Size(val widthDp: Float, val heightDp: Float) {
    val isValid: Boolean get() = widthDp.isFinite() && heightDp.isFinite() && widthDp > 0f && heightDp > 0f
  }

  data class Square(val sideDp: Float, val horizontalInsetDp: Float, val verticalInsetDp: Float) {
    // Round down so a fractional dp cannot budget an extra, clipped task row.
    val budgetSideDp: Int get() = floor(sideDp).toInt()
  }

  data class Orientations(val portrait: Size, val landscape: Size)
  data class PixelInsets(val left: Int, val top: Int, val right: Int, val bottom: Int)

  fun exactSizes(sizes: List<Size>): List<Size> = sizes.asSequence()
    .filter { it.isValid }.distinct().take(MAX_EXACT_SIZES).toList()

  fun square(size: Size): Square {
    require(size.isValid)
    val side = minOf(size.widthDp, size.heightDp)
    return Square(side, (size.widthDp - side) / 2f, (size.heightDp - side) / 2f)
  }

  fun fallback(minWidth: Int, minHeight: Int, maxWidth: Int, maxHeight: Int): Orientations {
    val widths = range(minWidth, maxWidth)
    val heights = range(minHeight, maxHeight)
    // Min/min is not an actual orientation: portrait is narrow/tall, landscape wide/short.
    return Orientations(Size(widths.first, heights.second), Size(widths.second, heights.first))
  }

  fun legacyInsets(size: Size, density: Float): PixelInsets {
    require(size.isValid)
    val scale = if (density.isFinite() && density > 0f) density else 1f
    val width = (size.widthDp * scale).roundToInt()
    val height = (size.heightDp * scale).roundToInt()
    val side = minOf(width, height)
    val horizontal = width - side
    val vertical = height - side
    // Split odd pixel differences without dropping a pixel or stretching the card.
    return PixelInsets(horizontal / 2, vertical / 2, horizontal - horizontal / 2, vertical - vertical / 2)
  }

  private fun range(minimum: Int, maximum: Int): Pair<Float, Float> {
    val values = listOf(minimum, maximum).filter { it > 0 }
    return if (values.isEmpty()) FALLBACK_SIDE_DP to FALLBACK_SIDE_DP
      else values.min().toFloat() to values.max().toFloat()
  }
}
