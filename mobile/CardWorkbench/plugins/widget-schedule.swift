import Foundation

// Shared by the generated WidgetKit extension and the macOS scheduling tests.
enum CardWorkbenchWidgetSchedule {
  private static let duePattern = try! NSRegularExpression(
    pattern: #"^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$"#
  )

  static func dueDate(_ value: String?) -> Date? {
    guard let value else { return nil }
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    let range = NSRange(text.startIndex..., in: text)
    guard let match = duePattern.firstMatch(in: text, range: range), match.range == range else {
      return nil
    }
    func part(_ index: Int) -> String? {
      guard let range = Range(match.range(at: index), in: text) else { return nil }
      return String(text[range])
    }
    guard let year = Int(part(1) ?? ""), year > 0,
          let month = Int(part(2) ?? ""), (1...12).contains(month),
          let day = Int(part(3) ?? ""), (1...31).contains(day) else { return nil }
    let hour = Int(part(4) ?? "0") ?? -1
    let minute = Int(part(5) ?? "0") ?? -1
    let second = Int(part(6) ?? "0") ?? -1
    guard (0...23).contains(hour), (0...59).contains(minute),
          (0...59).contains(second) else { return nil }

    var zone = TimeZone.autoupdatingCurrent
    var offsetSeconds = 0
    if let suffix = part(8) {
      if suffix == "Z" {
        zone = TimeZone(secondsFromGMT: 0)!
      } else {
        let pieces = suffix.dropFirst().split(separator: ":")
        guard pieces.count == 2, let hours = Int(pieces[0]), let minutes = Int(pieces[1]),
              hours <= 23, minutes <= 59 else { return nil }
        offsetSeconds = (hours * 60 + minutes) * 60 * (suffix.hasPrefix("-") ? -1 : 1)
        zone = TimeZone(secondsFromGMT: 0)!
      }
    }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let components = DateComponents(
      year: year, month: month, day: day, hour: hour, minute: minute, second: second
    )
    guard let date = calendar.date(from: components) else { return nil }
    let verified = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
    guard verified.year == year, verified.month == month, verified.day == day,
          verified.hour == hour, verified.minute == minute, verified.second == second else { return nil }
    let fraction = part(7).flatMap { Double("0." + $0) } ?? 0
    return date.addingTimeInterval(fraction - Double(offsetSeconds))
  }

  static func isVisible(_ task: [String: Any], at date: Date) -> Bool {
    let raw = (task["dueAt"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if raw.isEmpty { return true }
    guard let due = dueDate(raw) else { return false }
    return due <= date
  }

  static func visibleTasks(_ tasks: [[String: Any]], at date: Date) -> [[String: Any]] {
    tasks.filter { isVisible($0, at: date) }
  }

  static func entryDates(_ tasks: [[String: Any]], now: Date) -> [Date] {
    let future = tasks.compactMap { dueDate($0["dueAt"] as? String) }.filter { $0 > now }
    return [now] + Array(Set(future).sorted().prefix(64))
  }
}
