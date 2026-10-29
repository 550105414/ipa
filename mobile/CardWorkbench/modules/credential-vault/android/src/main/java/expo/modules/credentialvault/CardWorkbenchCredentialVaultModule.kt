package expo.modules.credentialvault

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.os.Build
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import java.util.UUID
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

class CardWorkbenchCredentialVaultModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CardWorkbenchCredentialVault")

    Function("newRecordId") {
      UUID.randomUUID().toString()
    }

    Function("supportsSyncKeyDerivation") {
      // PBKDF2WithHmacSHA256 is a public platform algorithm from API 26.
      // Keep API 24/25 supported through the existing JS implementation.
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
    }

    // Expo dispatches AsyncFunction away from the JS thread by default.
    AsyncFunction("deriveSyncKeyAsync") { passwordUtf8Base64: String, saltBase64: String ->
      check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        "Native sync key derivation is unsupported on this Android version."
      }
      val password = decodeCanonicalBase64(passwordUtf8Base64, SyncKeyDerivation.MAXIMUM_PASSWORD_BYTES)
      var salt: ByteArray? = null
      var key: ByteArray? = null
      try {
        salt = decodeCanonicalBase64(saltBase64, SyncKeyDerivation.SALT_LENGTH)
        key = SyncKeyDerivation.deriveKey(password, salt)
        Base64.encodeToString(key, Base64.NO_WRAP)
      } finally {
        password.fill(0)
        salt?.fill(0)
        key?.fill(0)
      }
    }

    AsyncFunction("encryptAsync") { recordId: String, plaintext: String ->
      require(recordId.isNotEmpty()) { "record id is required" }
      val encrypted = CredentialVaultPrimitives.encrypt(recordId, plaintext,
        loadMasterKey(createIfMissing = true))
      mapOf(
        "ciphertext" to Base64.encodeToString(encrypted, Base64.NO_WRAP),
        "keyVersion" to CredentialVaultPrimitives.KEY_VERSION,
      )
    }

    AsyncFunction("decryptAsync") { recordId: String, ciphertext: String, keyVersion: Int ->
      require(recordId.isNotEmpty()) { "record id is required" }
      require(keyVersion == CredentialVaultPrimitives.KEY_VERSION) { "unsupported key version" }
      val combined = try {
        Base64.decode(ciphertext, Base64.NO_WRAP)
      } catch (error: IllegalArgumentException) {
        throw IllegalArgumentException("ciphertext is not valid base64", error)
      }
      // Never generate a replacement key during a read. Restoring ciphertext
      // from another device does not restore its non-exportable private key.
      CredentialVaultPrimitives.decrypt(recordId, combined, keyVersion,
        loadMasterKey(createIfMissing = false))
    }

    AsyncFunction("generatePasswordAsync") {
        length: Int, uppercase: Boolean, lowercase: Boolean, numbers: Boolean, symbols: Boolean ->
      CredentialVaultPrimitives.generatePassword(length, uppercase, lowercase, numbers, symbols)
    }
  }

  private fun decodeCanonicalBase64(value: String, maximumBytes: Int): ByteArray {
    require(value.length <= ((maximumBytes + 2) / 3) * 4) {
      "Sync key input is not canonical Base64."
    }
    val decoded = try {
      Base64.decode(value, Base64.NO_WRAP)
    } catch (_: IllegalArgumentException) {
      throw IllegalArgumentException("Sync key input is not canonical Base64.")
    }
    if (decoded.size > maximumBytes || Base64.encodeToString(decoded, Base64.NO_WRAP) != value) {
      decoded.fill(0)
      throw IllegalArgumentException("Sync key input is not canonical Base64.")
    }
    return decoded
  }

  private fun loadMasterKey(createIfMissing: Boolean): SecretKey = synchronized(keyCreationLock) {
    val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    val existing = store.getKey(KEY_ALIAS, null)
    if (existing is SecretKey) return@synchronized existing
    check(existing == null && !store.containsAlias(KEY_ALIAS)) { "Credential vault key is invalid" }
    check(createIfMissing) {
      "Credential vault key is missing on this device; encrypted data cannot be decrypted."
    }
    KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).apply {
      init(KeyGenParameterSpec.Builder(KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setKeySize(256)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build())
    }.generateKey()
  }

  companion object {
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "com.xiaoke.salesworkspace.credential-vault.master-key-v1"
    // Protect the load/check/create sequence across all Expo module instances.
    private val keyCreationLock = Any()
  }
}
