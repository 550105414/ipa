import Foundation

// Use a distinct filename when compiling alongside plugins/widget-schedule.swift.
@main
enum WidgetScheduleTests {
  static func main() {
    let now = CardWorkbenchWidgetSchedule.dueDate("2026-10-07T10:00:00+08:00")!
    let due = CardWorkbenchWidgetSchedule.dueDate("2026-10-07T10:30:00+08:00")!
    let tasks: [[String: Any]] = [
      ["id": "unscheduled"],
      ["id": "past", "dueAt": "2026-10-06T12:00:00+08:00"],
      ["id": "future", "dueAt": "2026-10-07T10:30:00+08:00"],
      ["id": "same-time", "dueAt": "2026-10-07T02:30:00Z"],
      ["id": "invalid", "dueAt": "2026-02-30"],
    ]
    func ids(at date: Date) -> [String] {
      CardWorkbenchWidgetSchedule.visibleTasks(tasks, at: date).compactMap { $0["id"] as? String }
    }
    precondition(ids(at: now) == ["unscheduled", "past"])
    precondition(ids(at: due.addingTimeInterval(-0.001)) == ["unscheduled", "past"])
    precondition(ids(at: due) == ["unscheduled", "past", "future", "same-time"])
    precondition(CardWorkbenchWidgetSchedule.entryDates(tasks, now: now) == [now, due])
    precondition(CardWorkbenchWidgetSchedule.dueDate("2026-02-30") == nil)
    precondition(CardWorkbenchWidgetSchedule.dueDate("2026-11-06T24:00:00") == nil)
    precondition(CardWorkbenchWidgetSchedule.dueDate("2026-11-06T09:61:00Z") == nil)
    precondition(CardWorkbenchWidgetSchedule.dueDate("2028-02-29") != nil)
    precondition(CardWorkbenchWidgetSchedule.dueDate("2026-11-06T09:00+08:00") ==
                 CardWorkbenchWidgetSchedule.dueDate("2026-11-06T01:00:00Z"))
    precondition(CardWorkbenchWidgetSchedule.dueDate("2026-11-06T01:00:00.123Z")!.timeIntervalSince(
      CardWorkbenchWidgetSchedule.dueDate("2026-11-06T01:00:00Z")!
    ) > 0.122)

    // Date-only deadlines follow the phone's local calendar, not UTC midnight.
    let localMidnight = CardWorkbenchWidgetSchedule.dueDate("2026-11-06")!
    let parts = Calendar.current.dateComponents([.year, .month, .day, .hour], from: localMidnight)
    precondition(parts.year == 2026 && parts.month == 11 && parts.day == 6 && parts.hour == 0)
    let allDay: [String: Any] = ["dueAt": "2026-11-06"]
    precondition(!CardWorkbenchWidgetSchedule.isVisible(allDay, at: localMidnight.addingTimeInterval(-1)))
    precondition(CardWorkbenchWidgetSchedule.isVisible(allDay, at: localMidnight))

    let crowded: [[String: Any]] = (0..<100).map { index in
      ["id": String(index), "dueAt": ISO8601DateFormatter().string(from: now.addingTimeInterval(Double(index + 1) * 60))]
    } + [["id": "visible-after-100-future-tasks"]]
    precondition(CardWorkbenchWidgetSchedule.visibleTasks(crowded, at: now).count == 1)
    precondition(CardWorkbenchWidgetSchedule.entryDates(crowded, now: now).count == 65)
    precondition(CardWorkbenchWidgetSchedule.visibleTasks(crowded, at: now.addingTimeInterval(7000)).count == 101)
    print("Widget scheduling passed: exact boundary, local midnight, time zones, invalid dates, future entries, and > 8 tasks (\(TimeZone.current.identifier)).")
  }
}
