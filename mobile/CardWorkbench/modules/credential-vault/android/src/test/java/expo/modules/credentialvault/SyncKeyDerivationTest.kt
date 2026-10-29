package expo.modules.credentialvault

import java.nio.charset.CharacterCodingException
import org.junit.Assert.*
import org.junit.Test

class SyncKeyDerivationTest {
  private val salt = ByteArray(16) { it.toByte() }

  private fun derive(password: String): ByteArray {
    val bytes = password.toByteArray(Charsets.UTF_8)
    return try {
      SyncKeyDerivation.deriveKey(bytes, salt)
    } finally {
      bytes.fill(0)
    }
  }

  @Test fun fixedParametersMatchTheExistingWireProtocol() {
    assertEquals(310_000, SyncKeyDerivation.ITERATIONS)
    assertEquals(32, SyncKeyDerivation.KEY_LENGTH)
    assertEquals(16, SyncKeyDerivation.SALT_LENGTH)
    assertEquals(3072, SyncKeyDerivation.MAXIMUM_PASSWORD_BYTES)
  }

  @Test fun matchesNodeCryptoAndNobleUtf8VectorsWithoutNormalization() {
    // Generated independently with node:crypto.pbkdf2Sync(..., 310000, 32,
    // 'sha256') and verified against the existing Noble implementation.
    val vectors = listOf(
      "sync-password-123!" to "6d9c9cdf49248f0062f1718367e1a6d01dca369c3b4d301c092d141cd8402929",
      "同步密码测试中文十二字符" to "2352d161e38ab51841853e18affe40f5c9ceaadc5c1ff3be55b68efa5e32061e",
      "sync-🔒-密码-😀-12345" to "8d73eac6a40755be2821780a59afb0bdee2c78bb1cdaa2db21de5b97968c2bdf",
      "sync-password\u0000-123" to "3ebcd75f83d945c5f8ec76c294835d6bcd86399d0fda491840a78b0306f9c2ba",
      "sync-café-password" to "86b5dc51dd8bddf408adf9f8852d43e007c7d70521de2e45a2acccd9ce3f2f20",
      "sync-cafe\u0301-password" to "aaf80f699f813e83bd14d3d363493bf96af80702f0a7d36aba12f05bda4906f9",
      // JS TextEncoder replaces lone UTF-16 surrogates before the native call.
      "sync-\uFFFD-password-123" to "1c8f37b6da521e2bec6c1474034d335175fc0348628f04db38c53f9d4b75f7b7",
    )
    for ((password, expected) in vectors) {
      val result = derive(password)
      try {
        assertEquals(expected, result.joinToString("") { "%02x".format(it.toInt() and 0xff) })
      } finally {
        result.fill(0)
      }
    }
  }

  @Test fun preservesSaltBytesAndSupportsTheMaximumUtf8Password() {
    val original = salt.copyOf()
    val result = derive("中".repeat(1024))
    try {
      assertEquals(32, result.size)
      assertArrayEquals(original, salt)
    } finally {
      result.fill(0)
    }
  }

  @Test fun rejectsWrongSaltLengthEmptyOrOversizedPasswords() {
    for (length in listOf(0, 15, 17)) {
      assertThrows(IllegalArgumentException::class.java) {
        SyncKeyDerivation.deriveKey(byteArrayOf(65), ByteArray(length))
      }
    }
    for (length in listOf(0, 3073)) {
      assertThrows(IllegalArgumentException::class.java) {
        SyncKeyDerivation.deriveKey(ByteArray(length) { 65 }, salt)
      }
    }
  }

  @Test fun rejectsMalformedUtf8RatherThanDerivingADifferentKey() {
    val malformed = listOf(
      byteArrayOf(0xc3.toByte(), 0x28),
      byteArrayOf(0xc0.toByte(), 0x80.toByte()),
      byteArrayOf(0xed.toByte(), 0xa0.toByte(), 0x80.toByte()),
      byteArrayOf(0xf0.toByte(), 0x9f.toByte()),
    )
    for (bytes in malformed) {
      assertThrows(CharacterCodingException::class.java) {
        SyncKeyDerivation.deriveKey(bytes, salt)
      }
    }
  }
}
