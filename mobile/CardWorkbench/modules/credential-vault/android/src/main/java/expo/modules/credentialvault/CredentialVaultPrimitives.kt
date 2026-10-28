package expo.modules.credentialvault

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** JCA primitives shared by the Android bridge and host-JVM tests. */
internal object CredentialVaultPrimitives {
  const val KEY_VERSION = 1
  private const val NONCE_LENGTH = 12
  private const val TAG_LENGTH = 16
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  private val random = SecureRandom()

  private fun additionalData(recordId: String): ByteArray {
    require(recordId.isNotEmpty()) { "record id is required" }
    return "cardworkbench-credential|v$KEY_VERSION|$recordId".toByteArray(Charsets.UTF_8)
  }

  fun encrypt(recordId: String, plaintext: String, key: SecretKey): ByteArray {
    val aad = additionalData(recordId)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    // AndroidKeyStore chooses a fresh nonce. Do not supply our own IV or reuse a
    // Cipher: randomized encryption is enforced by the key's authorization.
    cipher.init(Cipher.ENCRYPT_MODE, key)
    val nonce = cipher.iv
    check(nonce.size == NONCE_LENGTH) { "AES-GCM returned an unsupported nonce length" }
    cipher.updateAAD(aad)
    val bytes = plaintext.toByteArray(Charsets.UTF_8)
    return try {
      // CryptoKit's combined format is nonce(12) | ciphertext | tag(16).
      nonce + cipher.doFinal(bytes)
    } finally {
      bytes.fill(0)
    }
  }

  fun decrypt(recordId: String, combined: ByteArray, keyVersion: Int, key: SecretKey): String {
    require(keyVersion == KEY_VERSION) { "unsupported key version" }
    require(combined.size >= NONCE_LENGTH + TAG_LENGTH) { "ciphertext is truncated" }
    val aad = additionalData(recordId)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key,
      GCMParameterSpec(TAG_LENGTH * 8, combined.copyOfRange(0, NONCE_LENGTH)))
    cipher.updateAAD(aad)
    val bytes = cipher.doFinal(combined, NONCE_LENGTH, combined.size - NONCE_LENGTH)
    return try {
      Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes)).toString()
    } finally {
      bytes.fill(0)
    }
  }

  fun generatePassword(
    length: Int,
    uppercase: Boolean,
    lowercase: Boolean,
    numbers: Boolean,
    symbols: Boolean,
  ): String {
    require(length in 12..64) { "password length must be between 12 and 64" }
    val groups = mutableListOf<String>()
    if (uppercase) groups.add("ABCDEFGHJKLMNPQRSTUVWXYZ")
    if (lowercase) groups.add("abcdefghijkmnopqrstuvwxyz")
    if (numbers) groups.add("23456789")
    if (symbols) groups.add("!@#$%^&*()-_=+[]{}")
    require(groups.isNotEmpty()) { "select at least one character group" }
    val alphabet = groups.joinToString("")
    val characters = CharArray(length)
    for ((index, group) in groups.withIndex()) {
      characters[index] = group[random.nextInt(group.length)]
    }
    for (index in groups.size until length) {
      characters[index] = alphabet[random.nextInt(alphabet.length)]
    }
    // SecureRandom.nextInt(bound) uses rejection sampling, not biased byte % N.
    for (index in characters.lastIndex downTo 1) {
      val other = random.nextInt(index + 1)
      val temporary = characters[index]
      characters[index] = characters[other]
      characters[other] = temporary
    }
    return try {
      String(characters)
    } finally {
      characters.fill('\u0000')
    }
  }
}
