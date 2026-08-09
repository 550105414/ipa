const AES_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const ENVELOPE_VERSION = "v1";

export class BankCardConfigurationError extends Error {
  constructor() {
    super("银行卡加密服务尚未正确配置");
    this.name = "BankCardConfigurationError";
  }
}

export class InvalidBankCardError extends Error {
  constructor() {
    super("银行卡号格式或校验失败");
    this.name = "InvalidBankCardError";
  }
}

export class BankCardCryptoError extends Error {
  constructor() {
    super("银行卡敏感资料处理失败");
    this.name = "BankCardCryptoError";
  }
}

export interface EncryptedBankCard {
  ciphertext: string;
  last4: string;
}

export function normalizeAndValidateCardNumber(input: unknown): string {
  if (typeof input !== "string") throw new InvalidBankCardError();

  // Only presentation separators are removable. Other characters must never
  // be silently discarded because that can turn malformed input into a PAN.
  const normalized = input.replace(/[\s-]/gu, "");
  if (!/^\d{12,19}$/.test(normalized)) throw new InvalidBankCardError();
  return normalized;
}

export async function assertBankCardEncryptionConfigured(): Promise<void> {
  await importEncryptionKey();
}

export async function encryptBankCardNumber(
  cardNumber: string,
  customerId: string,
): Promise<EncryptedBankCard> {
  const key = await importEncryptionKey();
  const iv = new Uint8Array(AES_GCM_IV_BYTES);
  globalThis.crypto.getRandomValues(iv);

  try {
    const encrypted = await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: encryptionContext(customerId),
        tagLength: AES_GCM_TAG_BITS,
      },
      key,
      toArrayBuffer(new TextEncoder().encode(cardNumber)),
    );
    return {
      ciphertext: `${ENVELOPE_VERSION}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`,
      last4: cardNumber.slice(-4),
    };
  } catch {
    throw new BankCardCryptoError();
  }
}

export async function decryptBankCardNumber(
  envelope: string,
  customerId: string,
): Promise<string> {
  const [version, encodedIv, encodedCiphertext, extra] = envelope.split(".");
  if (
    version !== ENVELOPE_VERSION ||
    !encodedIv ||
    !encodedCiphertext ||
    extra !== undefined
  ) {
    throw new BankCardCryptoError();
  }

  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    iv = base64UrlDecode(encodedIv);
    ciphertext = base64UrlDecode(encodedCiphertext);
  } catch {
    throw new BankCardCryptoError();
  }
  if (iv.byteLength !== AES_GCM_IV_BYTES || ciphertext.byteLength < 28) {
    throw new BankCardCryptoError();
  }

  try {
    const decrypted = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: encryptionContext(customerId),
        tagLength: AES_GCM_TAG_BITS,
      },
      await importEncryptionKey(),
      toArrayBuffer(ciphertext),
    );
    const cardNumber = new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
    return normalizeAndValidateCardNumber(cardNumber);
  } catch (error) {
    if (error instanceof BankCardConfigurationError) throw error;
    throw new BankCardCryptoError();
  }
}

async function importEncryptionKey(): Promise<CryptoKey> {
  const configuredKey = process.env.BANK_CARD_ENCRYPTION_KEY?.trim();
  if (!configuredKey) throw new BankCardConfigurationError();

  let rawKey: Uint8Array;
  try {
    rawKey = decodeStandardBase64(configuredKey);
  } catch {
    throw new BankCardConfigurationError();
  }
  if (rawKey.byteLength !== AES_KEY_BYTES) {
    throw new BankCardConfigurationError();
  }

  try {
    return await globalThis.crypto.subtle.importKey(
      "raw",
      toArrayBuffer(rawKey),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  } catch {
    throw new BankCardConfigurationError();
  }
}

function encryptionContext(customerId: string): ArrayBuffer {
  return toArrayBuffer(
    new TextEncoder().encode(
      JSON.stringify([
        "sales-workbench",
        1,
        "A256GCM",
        "customer.bank_card_pan",
        customerId.toLowerCase(),
      ]),
    ),
  );
}

function decodeStandardBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("invalid base64");
  const unpaddedLength = value.replace(/=+$/, "").length;
  if (unpaddedLength % 4 === 1) throw new Error("invalid base64");
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  if (normalized.length % 4 === 1) throw new Error("invalid base64url");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
