package expo.modules.cardworkbenchwidget

import java.util.Calendar
import java.util.Date
import java.util.GregorianCalendar
import java.util.TimeZone

/** Mirrors parseTodoDueDate without java.time (works on API 24/25 too). */
internal object TodoWidgetDates {
  private val pattern = Regex(
    "^(\\d{4})-(\\d{2})-(\\d{2})(?:[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,3}))?)?(Z|[+-]\\d{2}:\\d{2})?)?$",
  )

  fun parseDueAt(raw: String): Long? {
    val match = pattern.matchEntire(raw.trim()) ?: return null
    return try {
      val parts = match.groupValues
      val year = parts[1].toInt()
      val month = parts[2].toInt()
      val day = parts[3].toInt()
      val hour = parts[4].ifEmpty { "0" }.toInt()
      val minute = parts[5].ifEmpty { "0" }.toInt()
      val second = parts[6].ifEmpty { "0" }.toInt()
      val millis = parts[7].padEnd(3, '0').toInt()
      val zone = parts[8]
      if (year < 1 || month !in 1..12 || day !in 1..31 || hour !in 0..23 ||
        minute !in 0..59 || second !in 0..59) return null
      val calendar = GregorianCalendar(if (zone.isEmpty()) TimeZone.getDefault() else TimeZone.getTimeZone("UTC"))
      calendar.gregorianChange = Date(Long.MIN_VALUE)
      calendar.isLenient = false
      calendar.clear()
      calendar.set(year, month - 1, day, hour, minute, second)
      calendar.set(Calendar.MILLISECOND, millis)
      var instant = calendar.timeInMillis
      if (zone.isNotEmpty() && zone != "Z") {
        val zoneHours = zone.substring(1, 3).toInt()
        val zoneMinutes = zone.substring(4, 6).toInt()
        if (zoneHours > 23 || zoneMinutes > 59) return null
        val sign = if (zone[0] == '-') -1 else 1
        instant -= sign * (zoneHours * 60L + zoneMinutes) * 60_000L
      }
      instant
    } catch (_: IllegalArgumentException) {
      null
    }
  }
}
