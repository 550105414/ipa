import Foundation

enum TodoWidgetMessageDecoder {
    static func decode(_ body: Any) -> TodoWidgetSnapshot? {
        guard let payload = body as? [String: Any],
              let version = (payload["version"] as? NSNumber)?.intValue,
              version == 1,
              let rawItems = payload["items"] as? [[String: Any]] else {
            return nil
        }

        let updatedAt = (payload["generatedAt"] as? String).flatMap(parseDate) ?? .now
        let items = rawItems.prefix(20).compactMap(decodeItem)
        return TodoWidgetSnapshot(version: version, updatedAt: updatedAt, items: items)
    }

    private static func decodeItem(_ value: [String: Any]) -> TodoWidgetItem? {
        guard let id = value["id"] as? String,
              !id.isEmpty,
              id.count <= 100,
              let rawTitle = value["title"] as? String else {
            return nil
        }

        let title = rawTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.count <= 200 else {
            return nil
        }

        let dueAt = (value["dueAt"] as? String).flatMap(parseDate)
        return TodoWidgetItem(id: id, title: title, dueAt: dueAt)
    }

    private static func parseDate(_ value: String) -> Date? {
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractionalFormatter.date(from: value) {
            return date
        }
        return ISO8601DateFormatter().date(from: value)
    }
}
