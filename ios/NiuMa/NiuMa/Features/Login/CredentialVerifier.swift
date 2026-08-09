import Foundation

actor CredentialVerifier {
    private let configuration: LoginConfiguration

    init(configuration: LoginConfiguration) {
        self.configuration = configuration
    }

    func verify(account: String, password: String) -> Bool {
        guard account.trimmingCharacters(in: .whitespacesAndNewlines) == configuration.account,
              let salt = PasswordDerivation.decodeBase64URL(configuration.salt),
              let expected = PasswordDerivation.decodeBase64URL(configuration.verifier) else {
            return false
        }

        let candidate = PasswordDerivation.derive(
            password: password,
            salt: salt,
            rounds: configuration.rounds
        )
        return PasswordDerivation.constantTimeEquals(candidate, expected)
    }
}
