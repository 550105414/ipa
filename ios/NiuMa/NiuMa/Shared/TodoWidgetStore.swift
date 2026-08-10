import Foundation

enum TodoWidgetStore {
    static let appGroupIdentifier = "group.com.xiaoke.salesworkspace"
    static let messageHandlerName = "todoSnapshot"
    static let widgetKind = "TodoWidget"

    private static let snapshotKey = "todo-widget-snapshot-v1"

    @discardableResult
    static func save(_ snapshot: TodoWidgetSnapshot) -> Bool {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier),
              let data = try? encoder().encode(snapshot) else {
            return false
        }
        defaults.set(data, forKey: snapshotKey)
        return true
    }

    static func load() -> TodoWidgetSnapshot {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier),
              let data = defaults.data(forKey: snapshotKey),
              let snapshot = try? decoder().decode(TodoWidgetSnapshot.self, from: data) else {
            return .empty
        }
        return snapshot
    }

    private static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
