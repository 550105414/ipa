import Combine
import Foundation

@MainActor
final class WorkspaceDeepLinkStore: ObservableObject {
    @Published private(set) var pendingPath: String?

    func handle(_ url: URL) {
        guard url.scheme?.lowercased() == "niuma",
              url.host?.lowercased() == "tasks" else {
            return
        }
        pendingPath = "/tasks"
    }

    func consumePath() -> String? {
        defer { pendingPath = nil }
        return pendingPath
    }
}
