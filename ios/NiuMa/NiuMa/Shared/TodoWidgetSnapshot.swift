import Foundation

struct TodoWidgetSnapshot: Codable, Equatable, Sendable {
    let version: Int
    let updatedAt: Date
    let items: [TodoWidgetItem]

    static let empty = TodoWidgetSnapshot(version: 1, updatedAt: .distantPast, items: [])
}
