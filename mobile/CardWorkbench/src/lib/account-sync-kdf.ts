import CredentialVault from '@credential-vault';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { base64ToBytes, bytesToBase64, SYNC_KDF_ITERATIONS } from './account-sync-crypto';

/** Same v1 protocol, computed off the JS thread on supported native builds.
 * Only absent capability (web/old binary/Android 24–25) uses Noble. A failure
 * after selecting native must fail closed, never start another costly KDF.
 */
export async function deriveSyncKey(passwordUtf8: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  if (salt.length !== 16 || passwordUtf8.length < 1 || passwordUtf8.length > 3072) {
    throw new Error('同步密钥计算参数无效，未覆盖任何资料。');
  }
  if (!CredentialVault.supportsSyncKeyDerivation?.()) {
    return pbkdf2Async(sha256, passwordUtf8, salt, { c: SYNC_KDF_ITERATIONS, dkLen: 32, asyncTick: 10 });
  }
  if (typeof CredentialVault.deriveSyncKeyAsync !== 'function') {
    throw new Error('原生同步模块不完整，请安装完整新版；本机资料已保留。');
  }
  // Encoding the already-canonical UTF-8 bytes in JS preserves old envelope
  // passwords exactly, including NUL, emoji and lone-surrogate replacement.
  const key = base64ToBytes(await CredentialVault.deriveSyncKeyAsync(bytesToBase64(passwordUtf8), bytesToBase64(salt)));
  if (key.length !== 32) {
    key.fill(0);
    throw new Error('原生同步密钥计算结果无效，未覆盖任何资料。');
  }
  return key;
}
