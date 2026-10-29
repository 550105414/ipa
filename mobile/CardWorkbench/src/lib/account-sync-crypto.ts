import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { canonicalJson, validateSyncDocument, type SyncDocument } from './account-sync-model';

export type SyncEnvelope = { version: 1; kdf: 'pbkdf2-sha256'; iterations: 310000; salt: string; nonce: string; ciphertext: string };
export const SYNC_KDF_ITERATIONS = 310_000;
export const MAX_CIPHERTEXT_BYTES = 1024 * 1024;
// Stay comfortably below mobile engines' variadic-call limits. A large vault
// must not fail before upload just because Node accepts larger argument lists.
const BASE64_CHUNK_BYTES = 2048;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES));
  return btoa(binary);
}
export function base64ToBytes(value: string): Uint8Array {
  if (typeof value !== 'string' || value.length % 4 !== 0 || value.length > Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('同步密文编码无效。');
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length > MAX_CIPHERTEXT_BYTES || bytesToBase64(bytes) !== value) throw new Error('同步密文编码不是标准 Base64或超过容量，已停止。');
  return bytes;
}

export function validateSyncEnvelope(value: unknown): SyncEnvelope {
  const envelope = value as SyncEnvelope;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || Object.keys(envelope).sort().join(',') !== 'ciphertext,iterations,kdf,nonce,salt,version' || envelope.version !== 1 || envelope.kdf !== 'pbkdf2-sha256' || envelope.iterations !== SYNC_KDF_ITERATIONS || base64ToBytes(envelope.salt).length !== 16 || base64ToBytes(envelope.nonce).length !== 12 || base64ToBytes(envelope.ciphertext).length < 16) throw new Error('同步密文格式不兼容，已停止。');
  return envelope;
}

export function validateSyncPassword(password: string): void {
  if (typeof password !== 'string' || [...password].length < 12 || password.length > 1024) throw new Error('同步密码需要至少 12 个字符，且不能超过 1024 个字符。');
}

const associatedData = (scope: string) => utf8ToBytes(`cardworkbench-sync|v1|${scope}`);
export type SyncKeyDeriver = (passwordUtf8: Uint8Array, salt: Uint8Array) => Promise<Uint8Array>;
async function deriveKey(password: string, salt: Uint8Array, keyDeriver?: SyncKeyDeriver): Promise<Uint8Array> {
  validateSyncPassword(password);
  const passwordUtf8 = utf8ToBytes(password);
  try {
    const key = keyDeriver
      ? await keyDeriver(passwordUtf8, salt)
      : await pbkdf2Async(sha256, passwordUtf8, salt, { c: SYNC_KDF_ITERATIONS, dkLen: 32, asyncTick: 10 });
    if (!(key instanceof Uint8Array) || key.length !== 32) {
      if (key instanceof Uint8Array) key.fill(0);
      throw new Error('同步密钥计算结果无效，未覆盖任何资料。');
    }
    return key;
  } finally {
    passwordUtf8.fill(0);
  }
}

export async function encryptSyncDocument(password: string, scope: string, document: SyncDocument, randomBytes: (length: number) => Promise<Uint8Array>, reuseSalt?: string, keyDeriver?: SyncKeyDeriver): Promise<SyncEnvelope> {
  const plaintext = utf8ToBytes(canonicalJson(validateSyncDocument(document)));
  if (plaintext.length + 16 > MAX_CIPHERTEXT_BYTES) throw new Error('加密同步资料超过 1 MiB 容量，未上传，本机资料已保留；请先备份并整理资料。');
  const salt = reuseSalt ? base64ToBytes(reuseSalt) : await randomBytes(16);
  const nonce = await randomBytes(12);
  if (salt.length !== 16 || nonce.length !== 12) throw new Error('安全随机数生成失败。');
  let key: Uint8Array | undefined;
  try {
    key = await deriveKey(password, salt, keyDeriver);
    return { version: 1, kdf: 'pbkdf2-sha256', iterations: SYNC_KDF_ITERATIONS, salt: bytesToBase64(salt), nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(gcm(key, nonce, associatedData(scope)).encrypt(plaintext)) };
  } finally {
    key?.fill(0);
    plaintext.fill(0);
  }
}

export async function decryptSyncDocument(password: string, scope: string, value: unknown, keyDeriver?: SyncKeyDeriver): Promise<SyncDocument> {
  const envelope = validateSyncEnvelope(value);
  const key = await deriveKey(password, base64ToBytes(envelope.salt), keyDeriver);
  let plaintext: Uint8Array;
  try {
    plaintext = gcm(key, base64ToBytes(envelope.nonce), associatedData(scope)).decrypt(base64ToBytes(envelope.ciphertext));
  } catch {
    throw new Error('同步密码不正确，或密文已损坏；未覆盖任何云端或本机资料。');
  } finally {
    key.fill(0);
  }
  try {
    return validateSyncDocument(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)));
  } finally {
    plaintext.fill(0);
  }
}
