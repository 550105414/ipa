import Foundation

struct TodoWidgetItem: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let dueAt: Date?
}
