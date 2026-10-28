import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const moduleRoot = new URL('../modules/credential-vault/', import.meta.url);

test('the existing iOS vault and its Android implementation are both autolinked', async () => {
  const config = JSON.parse(await readFile(new URL('expo-module.config.json', moduleRoot), 'utf8'));
  assert.ok(config.platforms.includes('apple'));
  assert.ok(config.platforms.includes('android'));
  assert.deepEqual(config.apple.modules, ['CardWorkbenchCredentialVaultModule']);
  assert.deepEqual(config.android.modules, ['expo.modules.credentialvault.CardWorkbenchCredentialVaultModule']);
});

test('Android vault keeps its key non-exportable and never creates a new key while decrypting', async () => {
  const source = await readFile(new URL(
    'android/src/main/java/expo/modules/credentialvault/CardWorkbenchCredentialVaultModule.kt', moduleRoot), 'utf8');
  assert.match(source, /KeyStore\.getInstance\(ANDROID_KEYSTORE\)/);
  assert.match(source, /ANDROID_KEYSTORE = "AndroidKeyStore"/);
  assert.match(source, /\.setKeySize\(256\)/);
  assert.match(source, /\.setRandomizedEncryptionRequired\(true\)/);
  assert.match(source, /loadMasterKey\(createIfMissing = false\)/);
  assert.match(source, /synchronized\(keyCreationLock\)/);
  assert.ok(source.indexOf('check(createIfMissing)') < source.indexOf('KeyGenerator.getInstance'));
  assert.doesNotMatch(source, /\.encoded\b|\.getEncoded\(|deleteEntry\(|SharedPreferences|Log\./);
  for (const method of ['newRecordId', 'encryptAsync', 'decryptAsync', 'generatePasswordAsync']) {
    assert.ok(source.includes(`("${method}")`));
  }
});
