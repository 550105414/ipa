const KEY_BYTES = 32;
const IV_BYTES = 12;
const PREFIX = "xkbak1";

export class WorkspaceBackupError extends Error {
  constructor(message = "备份文件无法读取或已损坏") {
    super(message);
    this.name = "WorkspaceBackupError";
  }
}

export async function encryptWorkspaceBackup(payload: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: copyBuffer(iv),
      additionalData: context(),
      tagLength: 128,
    },
    await backupKey(),
    copyBuffer(new TextEncoder().encode(payload)),
  );
  return `${PREFIX}.${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}

export async function decryptWorkspaceBackup(envelope: string): Promise<string> {
  const [prefix, ivValue, ciphertextValue, extra] = envelope.trim().split(".");
  if (prefix !== PREFIX || !ivValue || !ciphertextValue || extra !== undefined) {
    throw new WorkspaceBackupError();
  }
  try {
    const iv = fromBase64Url(ivValue);
    const ciphertext = fromBase64Url(ciphertextValue);
    if (iv.byteLength !== IV_BYTES || ciphertext.byteLength < 17) {
      throw new WorkspaceBackupError();
    }
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: copyBuffer(iv),
        additionalData: context(),
        tagLength: 128,
      },
      await backupKey(),
      copyBuffer(ciphertext),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
  } catch (error) {
    if (error instanceof WorkspaceBackupError) throw error;
    throw new WorkspaceBackupError();
  }
}

async function backupKey(): Promise<CryptoKey> {
  const configured = process.env.BANK_CARD_ENCRYPTION_KEY?.trim();
  if (!configured) throw new WorkspaceBackupError("备份加密服务尚未配置");
  try {
    const binary = atob(configured.replace(/=+$/, "").padEnd(Math.ceil(configured.replace(/=+$/, "").length / 4) * 4, "="));
    const raw = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (raw.byteLength !== KEY_BYTES) throw new Error("invalid key");
    return crypto.subtle.importKey("raw", copyBuffer(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } catch {
    throw new WorkspaceBackupError("备份加密服务尚未配置");
  }
}

function context(): ArrayBuffer {
  return copyBuffer(new TextEncoder().encode("sales-workbench.workspace-backup.v1"));
}

function base64Url(bytes: Uint8Array): string {
  let value = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new WorkspaceBackupError();
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
