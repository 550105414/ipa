package expo.modules.credentialvault

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** Fixed wire-compatible PBKDF2 parameters; independent of Android for JVM vectors. */
internal object SyncKeyDerivation {
  const val ITERATIONS = 310_000
  const val KEY_LENGTH = 32
  const val SALT_LENGTH = 16
  const val MAXIMUM_PASSWORD_BYTES = 3072

  // The caller owns passwordUtf8 and wipes it after use. This function never
  // turns the plaintext password into an immutable Java String or persists it.
  fun deriveKey(passwordUtf8: ByteArray, salt: ByteArray): ByteArray {
    require(passwordUtf8.isNotEmpty() && passwordUtf8.size <= MAXIMUM_PASSWORD_BYTES) {
      "Sync password UTF-8 bytes are invalid."
    }
    require(salt.size == SALT_LENGTH) { "Sync key salt must contain 16 bytes." }
    val decoded = Charsets.UTF_8.newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT)
      .decode(ByteBuffer.wrap(passwordUtf8))
    val password = CharArray(decoded.remaining())
    decoded.get(password)
    if (decoded.hasArray()) decoded.array().fill('\u0000')
    var specification: PBEKeySpec? = null
    try {
      // PBEKeySpec's key length is bits. The UTF-8 JCA algorithm preserves
      // Chinese, surrogate-pair emoji and embedded NUL without normalization.
      specification = PBEKeySpec(password, salt, ITERATIONS, KEY_LENGTH * 8)
      val result = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        .generateSecret(specification).encoded
      if (result == null || result.size != KEY_LENGTH) {
        result?.fill(0)
        throw IllegalStateException("Native sync key derivation failed.")
      }
      return result
    } finally {
      specification?.clearPassword()
      password.fill('\u0000')
    }
  }
}
