import Foundation

// Compile together with ios/SyncKeyDerivation.swift on macOS. This exercises
// real CommonCrypto, not a substitute implementation or an Expo bridge mock.
@main
enum SyncKeyDerivationTests {
  static func main() throws {
    let salt = Data((0..<16).map { UInt8($0) }).base64EncodedString()
    let vectors: [(String, String)] = [
      ("sync-password-123!", "6d9c9cdf49248f0062f1718367e1a6d01dca369c3b4d301c092d141cd8402929"),
      ("同步密码测试中文十二字符", "2352d161e38ab51841853e18affe40f5c9ceaadc5c1ff3be55b68efa5e32061e"),
      ("sync-🔒-密码-😀-12345", "8d73eac6a40755be2821780a59afb0bdee2c78bb1cdaa2db21de5b97968c2bdf"),
      ("sync-password\u{0}-123", "3ebcd75f83d945c5f8ec76c294835d6bcd86399d0fda491840a78b0306f9c2ba"),
      ("sync-café-password", "86b5dc51dd8bddf408adf9f8852d43e007c7d70521de2e45a2acccd9ce3f2f20"),
      ("sync-cafe\u{301}-password", "aaf80f699f813e83bd14d3d363493bf96af80702f0a7d36aba12f05bda4906f9"),
      ("sync-\u{FFFD}-password-123", "1c8f37b6da521e2bec6c1474034d335175fc0348628f04db38c53f9d4b75f7b7"),
    ]
    precondition(SyncKeyDerivation.iterations == 310_000)
    precondition(SyncKeyDerivation.keyLength == 32)
    precondition(SyncKeyDerivation.saltLength == 16)
    precondition(SyncKeyDerivation.maximumPasswordBytes == 3072)
    for (password, expected) in vectors {
      let encoded = try SyncKeyDerivation.deriveKey(
        passwordUtf8Base64: Data(password.utf8).base64EncodedString(), saltBase64: salt)
      guard let bytes = Data(base64Encoded: encoded) else { fatalError("Invalid result encoding") }
      precondition(bytes.map { String(format: "%02x", $0) }.joined() == expected,
        "CommonCrypto must match Node and Noble UTF-8 vectors")
    }
    let maximumPassword = Data(String(repeating: "中", count: 1024).utf8).base64EncodedString()
    let maximumResult = try SyncKeyDerivation.deriveKey(passwordUtf8Base64: maximumPassword, saltBase64: salt)
    precondition(Data(base64Encoded: maximumResult)?.count == 32)

    let validPassword = Data("sync-password-123!".utf8).base64EncodedString()
    for invalidPassword in ["", "%%%", validPassword + "\n", "QR==",
      Data(repeating: 65, count: 3073).base64EncodedString()] {
      mustReject { try SyncKeyDerivation.deriveKey(passwordUtf8Base64: invalidPassword, saltBase64: salt) }
    }
    for length in [0, 15, 17] {
      mustReject {
        try SyncKeyDerivation.deriveKey(passwordUtf8Base64: validPassword,
          saltBase64: Data(repeating: 0, count: length).base64EncodedString())
      }
    }
    let malformedInputs: [[UInt8]] = [[0xc3, 0x28], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf0, 0x9f]]
    for malformed in malformedInputs {
      mustReject {
        try SyncKeyDerivation.deriveKey(passwordUtf8Base64: Data(malformed).base64EncodedString(), saltBase64: salt)
      }
    }
    print("CommonCrypto sync key derivation vectors and rejection tests passed.")
  }

  private static func mustReject(_ operation: () throws -> String) {
    do {
      _ = try operation()
      fatalError("Invalid sync key input was accepted")
    } catch {
      // Expected: no password, derived key or user data is logged.
    }
  }
}
