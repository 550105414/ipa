import {
  LocalVaultIntegrityError,
  LocalVaultUnavailableError,
  LocalVaultValidationError,
} from "./errors";

export const LOCAL_VAULT_SCHEMA_VERSION = 1;
export const PBKDF2_ITERATIONS = 210_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type EncryptedBytes = {
  iv: Uint8Array;
  ciphertext: Uint8Array;
};

export function webCrypto(): Crypto {
  const value = globalThis.crypto;
  if (!value?.subtle || typeof value.getRandomValues !== "function") {
    throw new LocalVaultUnavailableError();
  }
  return value;
}

export function randomBytes(length: number): Uint8Array {
  return webCrypto().getRandomValues(new Uint8Array(length));
}

export function randomId(prefix = "local_"): string {
  const cryptoValue = webCrypto();
  return `${prefix}${cryptoValue.randomUUID()}`;
}

export async function scopeDigest(userScope: string): Promise<string> {
  const normalized = validateUserScope(userScope);
  return bytesToBase64Url(
    new Uint8Array(await webCrypto().subtle.digest("SHA-256", encoder.encode(normalized))),
  );
}

export function validateUserScope(userScope: string): string {
  const normalized = userScope.trim();
  if (!normalized || normalized.length > 512) {
    throw new LocalVaultValidationError("本机资料库用户范围无效。");
  }
  return normalized;
}

export function decodeUnlockSecret(value: string): Uint8Array {
  if (typeof value !== "string" || !value.trim()) {
    throw new LocalVaultValidationError("本机资料库解锁凭据无效。");
  }
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new LocalVaultValidationError("本机资料库解锁凭据无效。");
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const raw = atob(padded);
    const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
    if (bytes.length < 32) throw new Error("short unlock secret");
    return bytes;
  } catch (error) {
    throw new LocalVaultValidationError(
      error instanceof Error && error.message === "short unlock secret"
        ? "本机资料库解锁凭据强度不足。"
        : "本机资料库解锁凭据无效。",
    );
  }
}

export async function deriveWrappingKey(
  password: string,
  unlockSecret: Uint8Array,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  if (!password || password.length > 1024 || iterations < PBKDF2_ITERATIONS) {
    throw new LocalVaultValidationError("本机资料库密码或密钥派生参数无效。");
  }
  const passwordBytes = encoder.encode(password);
  const combined = lengthDelimited(passwordBytes, unlockSecret);
  try {
    const material = await webCrypto().subtle.importKey(
      "raw",
      toArrayBuffer(combined),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await webCrypto().subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    passwordBytes.fill(0);
    combined.fill(0);
  }
}

export async function importMasterKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.byteLength !== 32) throw new LocalVaultIntegrityError();
  return webCrypto().subtle.importKey("raw", toArrayBuffer(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function derivePhoneIndexKey(
  rawMasterKey: Uint8Array,
  salt: Uint8Array,
  scopeKey: string,
  vaultId: string,
): Promise<CryptoKey> {
  return deriveHmacKey(rawMasterKey, salt, scopeKey, vaultId, "phone-index");
}

export async function deriveSummaryAuthKey(
  rawMasterKey: Uint8Array,
  salt: Uint8Array,
  scopeKey: string,
  vaultId: string,
): Promise<CryptoKey> {
  return deriveHmacKey(rawMasterKey, salt, scopeKey, vaultId, "summary-auth");
}

async function deriveHmacKey(
  rawMasterKey: Uint8Array,
  salt: Uint8Array,
  scopeKey: string,
  vaultId: string,
  purpose: string,
): Promise<CryptoKey> {
  const base = await webCrypto().subtle.importKey("raw", toArrayBuffer(rawMasterKey), "HKDF", false, [
    "deriveKey",
  ]);
  return webCrypto().subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(encoder.encode(`sales-workspace-local-vault|v${LOCAL_VAULT_SCHEMA_VERSION}|${scopeKey}|${vaultId}|${purpose}`)),
    },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<EncryptedBytes> {
  const iv = randomBytes(12);
  const ciphertext = new Uint8Array(
    await webCrypto().subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(aad),
        tagLength: 128,
      },
      key,
      toArrayBuffer(plaintext),
    ),
  );
  return { iv, ciphertext };
}

export async function decryptBytes(
  key: CryptoKey,
  encrypted: EncryptedBytes,
  aad: Uint8Array,
): Promise<Uint8Array> {
  validateEncryptedBytes(encrypted);
  try {
    return new Uint8Array(
      await webCrypto().subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(encrypted.iv),
          additionalData: toArrayBuffer(aad),
          tagLength: 128,
        },
        key,
        toArrayBuffer(encrypted.ciphertext),
      ),
    );
  } catch (error) {
    throw new LocalVaultIntegrityError({ cause: error });
  }
}

export function aadFor(
  scopeKey: string,
  vaultId: string,
  recordId: string,
  field: string,
): Uint8Array {
  return encoder.encode(
    JSON.stringify([
      "sales-workspace-local-vault",
      LOCAL_VAULT_SCHEMA_VERSION,
      scopeKey,
      vaultId,
      recordId,
      field,
    ]),
  );
}

export async function encryptText(
  key: CryptoKey,
  text: string,
  aad: Uint8Array,
): Promise<EncryptedBytes> {
  return encryptBytes(key, encoder.encode(text), aad);
}

export async function decryptText(
  key: CryptoKey,
  encrypted: EncryptedBytes,
  aad: Uint8Array,
): Promise<string> {
  const plaintext = await decryptBytes(key, encrypted, aad);
  try {
    return decoder.decode(plaintext);
  } catch (error) {
    throw new LocalVaultIntegrityError({ cause: error });
  } finally {
    plaintext.fill(0);
  }
}

export async function hmacToken(key: CryptoKey, token: string): Promise<string> {
  assertPhoneIndexKey(key);
  return bytesToBase64Url(
    new Uint8Array(
      await webCrypto().subtle.sign("HMAC", key, encoder.encode(token)),
    ),
  );
}

export function phoneFragments(phone: string): string[] {
  const fragments = new Set<string>();
  for (let length = 3; length <= Math.min(11, phone.length); length += 1) {
    for (let start = 0; start + length <= phone.length; start += 1) {
      fragments.add(phone.slice(start, start + length));
    }
  }
  return [...fragments];
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function lengthDelimited(first: Uint8Array, second: Uint8Array): Uint8Array {
  const result = new Uint8Array(8 + first.length + second.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, first.length, false);
  result.set(first, 4);
  view.setUint32(4 + first.length, second.length, false);
  result.set(second, 8 + first.length);
  return result;
}

function validateEncryptedBytes(value: EncryptedBytes): void {
  if (
    !(value?.iv instanceof Uint8Array) ||
    value.iv.byteLength !== 12 ||
    !(value.ciphertext instanceof Uint8Array) ||
    value.ciphertext.byteLength < 16
  ) {
    throw new LocalVaultIntegrityError();
  }
}

function assertPhoneIndexKey(key: CryptoKey): void {
  const algorithm = key.algorithm as HmacKeyAlgorithm;
  if (
    key.extractable ||
    algorithm.name !== "HMAC" ||
    algorithm.hash.name !== "SHA-256" ||
    !key.usages.includes("sign")
  ) {
    throw new LocalVaultIntegrityError();
  }
}
