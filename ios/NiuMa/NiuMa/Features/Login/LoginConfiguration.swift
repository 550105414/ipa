import Foundation

struct LoginConfiguration: Sendable {
    let account: String
    let salt: String
    let verifier: String
    let rounds: Int

    static let current = LoginConfiguration(
        account: "550105414",
        salt: "gt0i0X5f4yOQoth2EtzlQg",
        verifier: "-m6Un2U5GWrPv-VQzTR_0-hDuU4OGc6XHrqCFG9BceQ",
        rounds: 120_000
    )
}
