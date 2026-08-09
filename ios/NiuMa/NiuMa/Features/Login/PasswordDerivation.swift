import CryptoKit
import Foundation

enum PasswordDerivation {
    static func derive(password: String, salt: Data, rounds: Int) -> Data {
        precondition(rounds > 0)

        var firstBlock = Data(password.utf8)
        firstBlock.append(salt)
        var digest = Data(SHA256.hash(data: firstBlock))

        if rounds == 1 {
            return digest
        }

        for iteration in 1..<rounds {
            var block = Data()
            block.reserveCapacity(digest.count + salt.count + MemoryLayout<UInt32>.size)
            block.append(digest)
            block.append(salt)

            var counter = UInt32(iteration).bigEndian
            withUnsafeBytes(of: &counter) { bytes in
                block.append(contentsOf: bytes)
            }
            digest = Data(SHA256.hash(data: block))
        }

        return digest
    }

    static func decodeBase64URL(_ value: String) -> Data? {
        var normalized = value
            .replacing("-", with: "+")
            .replacing("_", with: "/")

        let padding = (4 - normalized.count % 4) % 4
        normalized.append(String(repeating: "=", count: padding))
        return Data(base64Encoded: normalized)
    }

    static func constantTimeEquals(_ lhs: Data, _ rhs: Data) -> Bool {
        guard lhs.count == rhs.count else {
            return false
        }

        let difference = zip(lhs, rhs).reduce(UInt8.zero) { partialResult, pair in
            partialResult | (pair.0 ^ pair.1)
        }
        return difference == 0
    }
}
