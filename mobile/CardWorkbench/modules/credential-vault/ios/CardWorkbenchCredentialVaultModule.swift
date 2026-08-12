import CryptoKit
import ExpoModulesCore
import Foundation
import Security

private let credentialVaultService = "com.xiaoke.salesworkspace.credential-vault"
private let credentialVaultAccount = "master-key-v1"
private let credentialVaultVersion = 1

private final class CredentialVaultException: GenericException<String>, @unchecked Sendable {
  override var reason: String { "Credential vault error: \(param)" }
}

public class CardWorkbenchCredentialVaultModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CardWorkbenchCredentialVault")

    Function("newRecordId") {
      UUID().uuidString.lowercased()
    }

    AsyncFunction("encryptAsync") { (recordID: String, plaintext: String) throws -> [String: Any] in
      guard !recordID.isEmpty else { throw CredentialVaultException("record id is required") }
      let key = try loadOrCreateMasterKey()
      let aad = Data("cardworkbench-credential|v\(credentialVaultVersion)|\(recordID)".utf8)
      let sealed = try AES.GCM.seal(Data(plaintext.utf8), using: key, authenticating: aad)
      guard let combined = sealed.combined else {
        throw CredentialVaultException("AES-GCM did not produce a combined payload")
      }
      return [
        "ciphertext": combined.base64EncodedString(),
        "keyVersion": credentialVaultVersion,
      ]
    }

    AsyncFunction("decryptAsync") { (recordID: String, ciphertext: String, keyVersion: Int) throws -> String in
      guard keyVersion == credentialVaultVersion else {
        throw CredentialVaultException("unsupported key version")
      }
      guard let combined = Data(base64Encoded: ciphertext) else {
        throw CredentialVaultException("ciphertext is not valid base64")
      }
      let key = try loadOrCreateMasterKey()
      let aad = Data("cardworkbench-credential|v\(credentialVaultVersion)|\(recordID)".utf8)
      let sealed = try AES.GCM.SealedBox(combined: combined)
      let plaintext = try AES.GCM.open(sealed, using: key, authenticating: aad)
      guard let value = String(data: plaintext, encoding: .utf8) else {
        throw CredentialVaultException("decrypted payload is not UTF-8")
      }
      return value
    }

    AsyncFunction("generatePasswordAsync") {
      (length: Int, uppercase: Bool, lowercase: Bool, numbers: Bool, symbols: Bool) throws -> String in
      guard (12...64).contains(length) else {
        throw CredentialVaultException("password length must be between 12 and 64")
      }

      var groups: [[Character]] = []
      if uppercase { groups.append(Array("ABCDEFGHJKLMNPQRSTUVWXYZ")) }
      if lowercase { groups.append(Array("abcdefghijkmnopqrstuvwxyz")) }
      if numbers { groups.append(Array("23456789")) }
      if symbols { groups.append(Array("!@#$%^&*()-_=+[]{}")) }
      guard !groups.isEmpty else {
        throw CredentialVaultException("select at least one character group")
      }

      var characters = try groups.map { group in group[try secureIndex(upperBound: group.count)] }
      let alphabet = groups.flatMap { $0 }
      while characters.count < length {
        characters.append(alphabet[try secureIndex(upperBound: alphabet.count)])
      }
      for index in stride(from: characters.count - 1, through: 1, by: -1) {
        let other = try secureIndex(upperBound: index + 1)
        if other != index { characters.swapAt(index, other) }
      }
      return String(characters)
    }
  }
}

private func loadOrCreateMasterKey() throws -> SymmetricKey {
  let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: credentialVaultService,
    kSecAttrAccount as String: credentialVaultAccount,
    kSecReturnData as String: true,
    kSecMatchLimit as String: kSecMatchLimitOne,
  ]
  var result: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &result)
  if status == errSecSuccess, let data = result as? Data, data.count == 32 {
    return SymmetricKey(data: data)
  }
  guard status == errSecItemNotFound else {
    throw CredentialVaultException("Keychain read failed (\(status))")
  }

  var bytes = [UInt8](repeating: 0, count: 32)
  guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
    throw CredentialVaultException("secure random generation failed")
  }
  let keyData = Data(bytes)
  for index in bytes.indices { bytes[index] = 0 }
  let add: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: credentialVaultService,
    kSecAttrAccount as String: credentialVaultAccount,
    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    kSecValueData as String: keyData,
  ]
  let addStatus = SecItemAdd(add as CFDictionary, nil)
  guard addStatus == errSecSuccess else {
    throw CredentialVaultException("Keychain write failed (\(addStatus))")
  }
  return SymmetricKey(data: keyData)
}

private func secureIndex(upperBound: Int) throws -> Int {
  guard upperBound > 0 else { throw CredentialVaultException("empty character group") }
  let rejectionLimit = UInt32.max - (UInt32.max % UInt32(upperBound))
  var value: UInt32 = 0
  repeat {
    guard SecRandomCopyBytes(kSecRandomDefault, MemoryLayout<UInt32>.size, &value) == errSecSuccess else {
      throw CredentialVaultException("secure random generation failed")
    }
  } while value >= rejectionLimit
  return Int(value % UInt32(upperBound))
}
