import Foundation

enum WorkspaceAddressError: LocalizedError {
    case invalidAddress

    var errorDescription: String? {
        "工作台地址无效。"
    }
}
