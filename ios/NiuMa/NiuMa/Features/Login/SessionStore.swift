import Observation
import SwiftUI

@MainActor
@Observable
final class SessionStore {
    private let credentialVerifier = CredentialVerifier(configuration: .current)
    private let maximumFailedAttempts = 5
    private let lockoutDuration: Duration = .seconds(60)
    private let backgroundSessionLifetime: TimeInterval = 5 * 60
    private var failedAttempts = 0
    private var backgroundedAt: Date?
    private var lockoutTask: Task<Void, Never>?

    private(set) var isAuthenticated = false
    private(set) var isSigningIn = false
    private(set) var lockoutEndsAt: Date?
    var errorMessage: String?

    var isLockedOut: Bool {
        guard let lockoutEndsAt else {
            return false
        }
        return lockoutEndsAt > .now
    }

    func signIn(account: String, password: String) async {
        guard !isSigningIn, !isLockedOut else {
            return
        }

        errorMessage = nil
        isSigningIn = true
        let isValid = await credentialVerifier.verify(account: account, password: password)
        isSigningIn = false

        guard isValid else {
            registerFailedAttempt()
            return
        }

        failedAttempts = 0
        lockoutTask?.cancel()
        lockoutEndsAt = nil
        isAuthenticated = true
    }

    func signOut() {
        isAuthenticated = false
        errorMessage = nil
        backgroundedAt = nil
    }

    func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .active:
            if let backgroundedAt,
               Date.now.timeIntervalSince(backgroundedAt) >= backgroundSessionLifetime {
                signOut()
            }
            backgroundedAt = nil
        case .background:
            backgroundedAt = .now
        case .inactive:
            break
        @unknown default:
            signOut()
        }
    }

    private func registerFailedAttempt() {
        failedAttempts += 1

        guard failedAttempts >= maximumFailedAttempts else {
            errorMessage = "账号或密码不正确，请重新输入。"
            return
        }

        failedAttempts = 0
        let lockoutEndsAt = Date.now.addingTimeInterval(60)
        self.lockoutEndsAt = lockoutEndsAt
        errorMessage = "尝试次数过多，请一分钟后再试。"
        scheduleLockoutReset(endingAt: lockoutEndsAt)
    }

    private func scheduleLockoutReset(endingAt endDate: Date) {
        lockoutTask?.cancel()
        let duration = lockoutDuration
        lockoutTask = Task { [weak self] in
            try? await Task.sleep(for: duration)
            guard !Task.isCancelled, let self, self.lockoutEndsAt == endDate else {
                return
            }
            self.lockoutEndsAt = nil
            self.errorMessage = nil
        }
    }
}
