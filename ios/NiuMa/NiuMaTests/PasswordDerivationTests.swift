import Foundation
import XCTest
@testable import NiuMa

final class PasswordDerivationTests: XCTestCase {
    func testDerivationMatchesIndependentVector() {
        let salt = Data((0..<16).map { UInt8($0) })
        let expected = Data([
            0xe1, 0x3f, 0x12, 0x22, 0xc6, 0x5d, 0x39, 0x7e,
            0xff, 0x38, 0xf9, 0x8a, 0x86, 0x14, 0x2e, 0xaf,
            0xc7, 0x24, 0x0e, 0x11, 0xa5, 0x74, 0x37, 0xa6,
            0xf4, 0xe0, 0xd9, 0x9d, 0x23, 0xf9, 0x50, 0xd5
        ])

        let actual = PasswordDerivation.derive(
            password: "correct-test-password",
            salt: salt,
            rounds: 1_000
        )

        XCTAssertEqual(actual, expected)
    }

    func testConstantTimeComparisonRejectsDifferentValues() {
        XCTAssertTrue(PasswordDerivation.constantTimeEquals(Data([1, 2]), Data([1, 2])))
        XCTAssertFalse(PasswordDerivation.constantTimeEquals(Data([1, 2]), Data([1, 3])))
        XCTAssertFalse(PasswordDerivation.constantTimeEquals(Data([1, 2]), Data([1])))
    }

    func testProductionVerifierContainsNoPlaintextPassword() {
        XCTAssertEqual(LoginConfiguration.current.rounds, 120_000)
        XCTAssertEqual(PasswordDerivation.decodeBase64URL(LoginConfiguration.current.salt)?.count, 16)
        XCTAssertEqual(PasswordDerivation.decodeBase64URL(LoginConfiguration.current.verifier)?.count, 32)
    }
}
