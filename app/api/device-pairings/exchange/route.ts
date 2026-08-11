import {
  hashCredentialSecret,
  issueDeviceToken,
  pairingIdFromCode,
  type StoredPairingRow,
  verifyPairingCode,
} from "@/lib/workspace/device-auth";
import {
  apiError,
  getWorkspaceDatabase,
  privateJson,
} from "@/lib/workspace/server";

const MAX_BODY_BYTES = 1024;

export async function POST(request: Request): Promise<Response> {
  let code: string;
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      throw new Error("too large");
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) throw new Error("too large");
    const body = JSON.parse(raw || "{}") as Record<string, unknown>;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "code") ||
      typeof body.code !== "string"
    ) {
      throw new Error("invalid body");
    }
    code = body.code.trim();
  } catch {
    return invalidPairingResponse();
  }

  const pairingId = pairingIdFromCode(code);
  if (!pairingId) return invalidPairingResponse();

  try {
    const db = await getWorkspaceDatabase();
    const pairing = await db
      .prepare(
        `SELECT id, owner_id, code_hash, expires_at, redeemed_at, revoked_at
         FROM device_pairings
         WHERE id = ?1
         LIMIT 1`,
      )
      .bind(pairingId)
      .first<StoredPairingRow>();
    const now = new Date();
    if (!pairing || !(await verifyPairingCode(code, pairing, now))) {
      return invalidPairingResponse();
    }

    const redemption = await db
      .prepare(
        `UPDATE device_pairings
         SET redeemed_at = ?1
         WHERE id = ?2
           AND redeemed_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > ?1`,
      )
      .bind(now.toISOString(), pairing.id)
      .run();
    if (Number(redemption.meta.changes ?? 0) !== 1) {
      return invalidPairingResponse();
    }

    const deviceCredential = issueDeviceToken();
    const tokenHash = await hashCredentialSecret(deviceCredential.secret);
    const insertion = await db
      .prepare(
        `INSERT INTO device_tokens (
          id, owner_id, pairing_id, token_hash, device_name,
          created_at, last_used_at, revoked_at
        )
        SELECT ?1, owner_id, id, ?2, device_name, ?3, NULL, NULL
        FROM device_pairings
        WHERE id = ?4 AND redeemed_at = ?3`,
      )
      .bind(deviceCredential.id, tokenHash, now.toISOString(), pairing.id)
      .run();
    if (Number(insertion.meta.changes ?? 0) !== 1) {
      return apiError(503, "PAIRING_UNAVAILABLE", "App 配对服务暂时不可用，请重新生成配对链接");
    }

    return privateJson(
      {
        deviceToken: deviceCredential.token,
        tokenId: deviceCredential.id,
      },
      201,
    );
  } catch {
    return apiError(503, "PAIRING_UNAVAILABLE", "App 配对服务暂时不可用，请重新生成配对链接");
  }
}

function invalidPairingResponse(): Response {
  return apiError(401, "PAIRING_INVALID", "配对链接无效、已使用或已过期");
}
