export const MOBILE_SYNC_ITERATIONS = 310_000;
export const MOBILE_SYNC_MAX_CIPHERTEXT_BYTES = 1_048_576;
// Base64 encoding plus fixed envelope metadata; bound actual streamed bytes,
// not the caller-controlled Content-Length header.
export const MOBILE_SYNC_MAX_REQUEST_BYTES = Math.ceil(MOBILE_SYNC_MAX_CIPHERTEXT_BYTES / 3) * 4 + 2048;

export type MobileSyncEnvelope = {
  version: 1;
  kdf: "pbkdf2-sha256";
  iterations: 310000;
  salt: string;
  nonce: string;
  ciphertext: string;
};

type StoredRow = { revision: number; envelope_json: string; updated_at: string };
type RevisionRow = { revision: number; updated_at: string };
type Database = {
  prepare(sql: string): {
    bind(...values: (string | number)[]): {
      first<T>(): Promise<T | null>;
    };
  };
};

type Dependencies = {
  userId(request: Request): Promise<string | null>;
  database(): Promise<Database>;
  respond(body: unknown, status?: number, headers?: HeadersInit): Response;
};

class InvalidMobileSyncRequest extends Error {
  constructor(readonly status: number) {
    super("Invalid mobile sync request");
  }
}

function exactKeys(value: unknown, expected: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
}

function base64Bytes(value: unknown, min: number, max: number): value is string {
  if (typeof value !== "string" || value.length > Math.ceil(max / 3) * 4 ||
    value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  try {
    const bytes = atob(value);
    return bytes.length >= min && bytes.length <= max && btoa(bytes) === value;
  } catch {
    return false;
  }
}

/** Opaque, fixed-algorithm envelope. The server never derives its key. */
export function validateMobileSyncEnvelope(value: unknown): MobileSyncEnvelope | null {
  if (!exactKeys(value, ["version", "kdf", "iterations", "salt", "nonce", "ciphertext"]) ||
    value.version !== 1 || value.kdf !== "pbkdf2-sha256" || value.iterations !== MOBILE_SYNC_ITERATIONS ||
    !base64Bytes(value.salt, 16, 16) || !base64Bytes(value.nonce, 12, 12) ||
    !base64Bytes(value.ciphertext, 16, MOBILE_SYNC_MAX_CIPHERTEXT_BYTES)) return null;
  return {
    version: 1,
    kdf: "pbkdf2-sha256",
    iterations: MOBILE_SYNC_ITERATIONS,
    salt: value.salt,
    nonce: value.nonce,
    ciphertext: value.ciphertext,
  };
}

export async function mobileSyncScope(userId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(`cardworkbench-mobile-sync|${userId}`),
  ));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function trustedOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  // Native clients do not supply Origin. Browser clients must be same-origin.
  return origin === null || origin === new URL(request.url).origin;
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new InvalidMobileSyncRequest(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MOBILE_SYNC_MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => {});
        throw new InvalidMobileSyncRequest(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InvalidMobileSyncRequest(400);
  }
}

// A single SQLite statement performs both creation and compare-and-swap. The
// EXISTS guard forbids creating a missing record with an expectedRevision > 0.
// No pre-read, replace, or unconditional upsert can overwrite another writer.
const COMPARE_AND_SWAP = `
  INSERT INTO mobile_sync_vaults (owner_id, revision, envelope_json, updated_at)
  SELECT ?1, 1, ?2, ?3
  WHERE ?4 = 0 OR EXISTS (SELECT 1 FROM mobile_sync_vaults WHERE owner_id = ?1)
  ON CONFLICT(owner_id) DO UPDATE SET
    revision = mobile_sync_vaults.revision + 1,
    envelope_json = excluded.envelope_json,
    updated_at = excluded.updated_at
  WHERE mobile_sync_vaults.revision = ?4 AND mobile_sync_vaults.revision < 9007199254740991
  RETURNING revision, updated_at
`;

export function createMobileSyncHandlers(dependencies: Dependencies) {
  const response = (body: unknown, status = 200) => dependencies.respond(body, status, {
    "X-Content-Type-Options": "nosniff",
  });
  const error = (status: number, code: string, message: string) => response({ error: { code, message } }, status);

  async function authenticate(request: Request): Promise<string | Response> {
    if (!trustedOrigin(request)) return error(403, "ORIGIN_REJECTED", "不允许的请求来源");
    const user = await dependencies.userId(request);
    if (!user) return error(401, "AUTH_REQUIRED", "请先登录后再同步");
    return user;
  }

  return {
    async GET(request: Request): Promise<Response> {
      try {
        const user = await authenticate(request);
        if (typeof user !== "string") return user;
        const db = await dependencies.database();
        const row = await db.prepare(
          "SELECT revision, envelope_json, updated_at FROM mobile_sync_vaults WHERE owner_id = ?1 LIMIT 1",
        ).bind(user).first<StoredRow>();
        const scope = await mobileSyncScope(user);
        if (!row) return response({ scope, revision: 0, envelope: null, updatedAt: null });
        const envelope = validateMobileSyncEnvelope(JSON.parse(row.envelope_json));
        if (!envelope || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error("Invalid stored sync row");
        return response({ scope, revision: row.revision, envelope, updatedAt: row.updated_at });
      } catch {
        return error(503, "MOBILE_SYNC_UNAVAILABLE", "暂时无法同步，请稍后重试");
      }
    },

    async PUT(request: Request): Promise<Response> {
      try {
        const user = await authenticate(request);
        if (typeof user !== "string") return user;
        if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
          return error(415, "JSON_REQUIRED", "请使用 JSON 请求");
        }
        const body = await readBoundedJson(request);
        if (!exactKeys(body, ["expectedRevision", "envelope"]) ||
          typeof body.expectedRevision !== "number" || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
          throw new InvalidMobileSyncRequest(400);
        }
        const envelope = validateMobileSyncEnvelope(body.envelope);
        if (!envelope) throw new InvalidMobileSyncRequest(400);
        const db = await dependencies.database();
        const row = await db.prepare(COMPARE_AND_SWAP)
          .bind(user, JSON.stringify(envelope), new Date().toISOString(), body.expectedRevision)
          .first<RevisionRow>();
        if (!row) return error(409, "MOBILE_SYNC_CONFLICT", "另一台设备已更新，请刷新后重试");
        return response({ revision: row.revision, updatedAt: row.updated_at });
      } catch (cause) {
        if (cause instanceof InvalidMobileSyncRequest) {
          return error(cause.status, cause.status === 413 ? "SYNC_PAYLOAD_TOO_LARGE" : "INVALID_SYNC_PAYLOAD",
            cause.status === 413 ? "同步数据过大" : "同步数据无效");
        }
        return error(503, "MOBILE_SYNC_UNAVAILABLE", "暂时无法同步，请稍后重试");
      }
    },
  };
}
