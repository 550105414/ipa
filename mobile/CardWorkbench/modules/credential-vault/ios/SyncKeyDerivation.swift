import CommonCrypto
import Foundation

// Intentionally independent of Expo so macOS CI tests exercise the exact
// CommonCrypto implementation used by the iOS bridge.
enum SyncKeyDerivation {
  static let iterations: UInt32 = 310_000
  static let keyLength = 32
  static let saltLength = 16
  static let maximumPasswordBytes = 3072

  enum DerivationError: String, Error, LocalizedError {
    case invalidEncoding = "Sync key input is not canonical Base64."
    case invalidPassword = "Sync password UTF-8 bytes are invalid."
    case invalidSalt = "Sync key salt must contain 16 bytes."
    case derivationFailed = "Native sync key derivation failed."

    var errorDescription: String? { rawValue }
  }

  static func deriveKey(passwordUtf8Base64: String, saltBase64: String) throws -> String {
    var password = try decodeCanonicalBase64(passwordUtf8Base64, maximumBytes: maximumPasswordBytes)
    defer { _ = password.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) } }
    // JS encodes with TextEncoder before crossing the bridge. Never trim,
    // normalize Unicode, or interpret NUL as a C-string terminator.
    guard !password.isEmpty, String(bytes: password, encoding: .utf8) != nil else {
      throw DerivationError.invalidPassword
    }

    var salt = try decodeCanonicalBase64(saltBase64, maximumBytes: saltLength)
    defer { _ = salt.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) } }
    guard salt.count == saltLength else { throw DerivationError.invalidSalt }

    var key = [UInt8](repeating: 0, count: keyLength)
    defer { _ = key.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) } }
    let passwordCount = password.count
    let saltCount = salt.count
    let status = password.withUnsafeBytes { passwordBuffer in
      salt.withUnsafeBytes { saltBuffer in
        key.withUnsafeMutableBytes { keyBuffer in
          CCKeyDerivationPBKDF(
            CCPBKDFAlgorithm(kCCPBKDF2),
            passwordBuffer.baseAddress!.assumingMemoryBound(to: Int8.self), passwordCount,
            saltBuffer.baseAddress!.assumingMemoryBound(to: UInt8.self), saltCount,
            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), iterations,
            keyBuffer.baseAddress!.assumingMemoryBound(to: UInt8.self), keyLength)
        }
      }
    }
    guard status == kCCSuccess else { throw DerivationError.derivationFailed }
    // The bridge result is transient only; it must never be saved or logged.
    var keyData = Data(key)
    defer { keyData.resetBytes(in: 0..<keyData.count) }
    return keyData.base64EncodedString()
  }

  private static func decodeCanonicalBase64(_ value: String, maximumBytes: Int) throws -> [UInt8] {
    guard value.utf8.count <= ((maximumBytes + 2) / 3) * 4,
          var decoded = Data(base64Encoded: value) else {
      throw DerivationError.invalidEncoding
    }
    defer { decoded.resetBytes(in: 0..<decoded.count) }
    guard decoded.count <= maximumBytes, decoded.base64EncodedString() == value else {
      throw DerivationError.invalidEncoding
    }
    return Array(decoded)
  }
}
