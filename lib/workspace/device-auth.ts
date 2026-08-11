const DEVICE_TOKEN_HEADER = "x-workspace-device-token";
const PAIRING_PREFIX = "wpp";
const DEVICE_PREFIX = "wdt";
const SECRET_BYTES = 32;
const HASH_BYTES = 32;
const MAX_DEVICE_TOKEN_LENGTH = 256;

type HeaderReader = Pick<Headers, "get">;

export interface StoredDeviceTokenRow {
  id: string;
  owner_id: string;
  token_hash: string;
  revoked_at: string | null;
}

export interface StoredPairingRow {
  id: string;
  owner_id: string;
  code_hash: string;
  expires_at: string;
  redeemed_at: string | null;
  revoked_at: string | null;
}

export class DevicePairingConfigurationError extends Error {
  constructor() {
    super("iPhone App 配对服务尚未配置");
    this.name = "DevicePairingConfigurationError";
  }
}

export function workspaceDeviceToken(headers: HeaderReader): string | null {
  const value = headers.get(DEVICE_TOKEN_HEADER)?.trim() ?? "";
  return value.length > 0 && value.length <= MAX_DEVICE_TOKEN_LENGTH
    ? value
    : null;
}

export async function authenticateWorkspaceDevice(
  db: D1Database,
  token: string,
): Promise<string | null> {
  const parsed = parseCredential(token, DEVICE_PREFIX);
  if (!parsed) return null;

  const row = await db
    .prepare(
      `SELECT id, owner_id, token_hash, revoked_at
       FROM device_tokens
       WHERE id = ?1
       LIMIT 1`,
    )
    .bind(parsed.id)
    .first<StoredDeviceTokenRow>();
  if (!row || row.revoked_at) return null;

  const candidateHash = await hashCredentialSecret(parsed.secret);
  if (!constantTimeHashEqual(candidateHash, row.token_hash)) return null;

  const now = new Date();
  const staleBefore = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `UPDATE device_tokens
       SET last_used_at = ?1
       WHERE id = ?2
         AND revoked_at IS NULL
         AND (last_used_at IS NULL OR last_used_at < ?3)`,
    )
    .bind(now.toISOString(), row.id, staleBefore)
    .run();

  return row.owner_id;
}

export function issuePairingCode(): { id: string; code: string; secret: string } {
  return issueCredential(PAIRING_PREFIX);
}

export function issueDeviceToken(): {
  id: string;
  token: string;
  secret: string;
} {
  const credential = issueCredential(DEVICE_PREFIX);
  return { id: credential.id, token: credential.code, secret: credential.secret };
}

export async function hashCredentialSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function verifyPairingCode(
  code: string,
  row: StoredPairingRow,
  now = new Date(),
): Promise<boolean> {
  const parsed = parseCredential(code, PAIRING_PREFIX);
  if (!parsed || parsed.id !== row.id) return false;
  if (row.redeemed_at || row.revoked_at) return false;
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return false;
  const candidateHash = await hashCredentialSecret(parsed.secret);
  return constantTimeHashEqual(candidateHash, row.code_hash);
}

export function pairingIdFromCode(code: string): string | null {
  return parseCredential(code, PAIRING_PREFIX)?.id ?? null;
}

export function buildPairingDeepLink(input: {
  baseUrl: string;
  code: string;
  dispatchToken: string;
}): string {
  const parameters = new URLSearchParams({
    base_url: input.baseUrl,
    code: input.code,
    dispatch_token: input.dispatchToken,
  });
  return `cardworkbench://pair?${parameters.toString()}`;
}

export function sitesDispatchBypassToken(): string {
  const value = process.env.SITES_SIWC_BYPASS_TOKEN?.trim() ?? "";
  if (!value || value.length > 8192) {
    throw new DevicePairingConfigurationError();
  }
  return value;
}

export function constantTimeHashEqual(left: string, right: string): boolean {
  const leftBytes = base64UrlToBytes(left);
  const rightBytes = base64UrlToBytes(right);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < HASH_BYTES; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0 && leftBytes.length === HASH_BYTES;
}

function issueCredential(prefix: string): {
  id: string;
  code: string;
  secret: string;
} {
  const id = crypto.randomUUID().replaceAll("-", "");
  const secret = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
  return { id, secret, code: `${prefix}_${id}.${secret}` };
}

function parseCredential(
  value: string,
  expectedPrefix: string,
): { id: string; secret: string } | null {
  if (value.length > MAX_DEVICE_TOKEN_LENGTH) return null;
  const matched = /^([a-z]{3})_([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!matched || matched[1] !== expectedPrefix) return null;
  return { id: matched[2], secret: matched[3] };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return new Uint8Array();
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}
