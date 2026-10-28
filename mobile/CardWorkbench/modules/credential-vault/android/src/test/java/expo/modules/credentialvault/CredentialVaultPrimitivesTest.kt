package expo.modules.credentialvault

import java.nio.charset.CharacterCodingException
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.junit.Assert.*
import org.junit.Test

class CredentialVaultPrimitivesTest {
  private fun key(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

  @Test fun unicodeAndEmptyPayloadsRoundTripInCombinedFormat() {
    val key = key()
    for (plaintext in listOf("", "账号: 微信📒\n密码含é和中文", "a".repeat(32000))) {
      val encrypted = CredentialVaultPrimitives.encrypt("record-1", plaintext, key)
      assertEquals(plaintext.toByteArray(Charsets.UTF_8).size + 12 + 16, encrypted.size)
      val encoded = Base64.getEncoder().encodeToString(encrypted)
      assertEquals(plaintext, CredentialVaultPrimitives.decrypt(
        "record-1", Base64.getDecoder().decode(encoded), 1, key))
    }
  }

  @Test fun decryptAcceptsExpectedCryptoKitLayoutAndExactRecordAssociatedData() {
    val key = key()
    // A fixed nonce is only a wire-format fixture here, never a production IV.
    val nonce = ByteArray(12) { it.toByte() }
    val reference = Cipher.getInstance("AES/GCM/NoPadding")
    reference.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce))
    reference.updateAAD("cardworkbench-credential|v1|case-Sensitive-ID".toByteArray(Charsets.UTF_8))
    val combined = nonce + reference.doFinal("protected".toByteArray(Charsets.UTF_8))
    assertEquals("protected", CredentialVaultPrimitives.decrypt("case-Sensitive-ID", combined, 1, key))
    assertThrows(AEADBadTagException::class.java) {
      CredentialVaultPrimitives.decrypt("case-sensitive-id", combined, 1, key)
    }
  }

  @Test fun eachEncryptionChoosesAFreshNonce() {
    val key = key()
    val nonces = (1..64).map {
      Base64.getEncoder().encodeToString(
        CredentialVaultPrimitives.encrypt("same-record", "same content", key).copyOfRange(0, 12))
    }
    assertEquals(nonces.size, nonces.toSet().size)
  }

  @Test fun swappedRecordWrongKeyAndTamperingAreRejected() {
    val key = key()
    val encrypted = CredentialVaultPrimitives.encrypt("record-a", "secret", key)
    assertThrows(AEADBadTagException::class.java) {
      CredentialVaultPrimitives.decrypt("record-b", encrypted, 1, key)
    }
    assertThrows(AEADBadTagException::class.java) {
      CredentialVaultPrimitives.decrypt("record-a", encrypted, 1, key())
    }
    for (index in listOf(0, 12, encrypted.lastIndex)) {
      val changed = encrypted.copyOf()
      changed[index] = (changed[index].toInt() xor 1).toByte()
      assertThrows(AEADBadTagException::class.java) {
        CredentialVaultPrimitives.decrypt("record-a", changed, 1, key)
      }
    }
  }

  @Test fun unsupportedVersionsTruncationAndMissingRecordIdsFailClosed() {
    val key = key()
    val encrypted = CredentialVaultPrimitives.encrypt("record", "content", key)
    assertThrows(IllegalArgumentException::class.java) {
      CredentialVaultPrimitives.decrypt("record", encrypted, 2, key)
    }
    for (length in listOf(0, 11, 12, 27)) {
      assertThrows(IllegalArgumentException::class.java) {
        CredentialVaultPrimitives.decrypt("record", ByteArray(length), 1, key)
      }
    }
    assertThrows(IllegalArgumentException::class.java) {
      CredentialVaultPrimitives.encrypt("", "content", key)
    }
    assertThrows(IllegalArgumentException::class.java) {
      CredentialVaultPrimitives.decrypt("", encrypted, 1, key)
    }
  }

  @Test fun invalidUtf8IsNotSilentlyReplacedAfterAuthentication() {
    val key = key()
    val nonce = ByteArray(12) { (it + 12).toByte() }
    val reference = Cipher.getInstance("AES/GCM/NoPadding")
    reference.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce))
    reference.updateAAD("cardworkbench-credential|v1|record".toByteArray(Charsets.UTF_8))
    val combined = nonce + reference.doFinal(byteArrayOf(0xC3.toByte(), 0x28))
    assertThrows(CharacterCodingException::class.java) {
      CredentialVaultPrimitives.decrypt("record", combined, 1, key)
    }
  }

  @Test fun passwordsContainEverySelectedGroupAndRespectRequestedLength() {
    val groups = listOf("ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*()-_=+[]{}")
    for (length in listOf(12, 20, 64)) {
      repeat(64) {
        val password = CredentialVaultPrimitives.generatePassword(length, true, true, true, true)
        assertEquals(length, password.length)
        for (group in groups) assertTrue(password.any { group.contains(it) })
        assertTrue(password.all { groups.joinToString("").contains(it) })
      }
    }
  }

  @Test fun unselectedPasswordGroupsAreNeverAdded() {
    val groups = listOf("ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*()-_=+[]{}")
    for ((index, group) in groups.withIndex()) {
      repeat(32) {
        val password = CredentialVaultPrimitives.generatePassword(24,
          index == 0, index == 1, index == 2, index == 3)
        assertEquals(24, password.length)
        assertTrue(password.all { group.contains(it) })
      }
    }
  }

  @Test fun invalidPasswordRequestsFailInsteadOfReturningWeakFallbacks() {
    for (length in listOf(-1, 0, 11, 65, 200)) {
      assertThrows(IllegalArgumentException::class.java) {
        CredentialVaultPrimitives.generatePassword(length, true, true, true, true)
      }
    }
    assertThrows(IllegalArgumentException::class.java) {
      CredentialVaultPrimitives.generatePassword(20, false, false, false, false)
    }
  }
}
