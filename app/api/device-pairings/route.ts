import { localVaultAuthenticatedUserId } from "@/lib/security/local-vault-server";
import {
  buildPairingDeepLink,
  DevicePairingConfigurationError,
  hashCredentialSecret,
  issuePairingCode,
  sitesDispatchBypassToken,
} from "@/lib/workspace/device-auth";
import {
  apiError,
  getWorkspaceDatabase,
  privateJson,
} from "@/lib/workspace/server";

const PAIRING_LIFETIME_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 1024;

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginBrowserRequest(request)) {
    return apiError(403, "PAIRING_REQUEST_DENIED", "无法创建 App 配对请求");
  }

  const ownerId = localVaultAuthenticatedUserId(request);
  if (!ownerId) {
    return apiError(401, "AUTH_REQUIRED", "请先在网页端登录后再绑定 iPhone App");
  }

  let deviceName = "iPhone";
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      throw new Error("too large");
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) throw new Error("too large");
    if (raw) {
      const body = JSON.parse(raw) as Record<string, unknown>;
      if (!body || Array.isArray(body) || Object.keys(body).some((key) => key !== "deviceName")) {
        throw new Error("invalid body");
      }
      if (body.deviceName !== undefined) {
        if (typeof body.deviceName !== "string") throw new Error("invalid name");
        const normalized = body.deviceName.trim();
        if (!normalized || normalized.length > 80) throw new Error("invalid name");
        deviceName = normalized;
      }
    }
  } catch {
    return apiError(400, "INVALID_PAIRING_REQUEST", "配对请求格式无效");
  }

  let dispatchToken: string;
  try {
    dispatchToken = sitesDispatchBypassToken();
  } catch (error) {
    return apiError(
      503,
      "PAIRING_NOT_CONFIGURED",
      error instanceof DevicePairingConfigurationError
        ? error.message
        : "iPhone App 配对服务暂时不可用",
    );
  }

  const credential = issuePairingCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_LIFETIME_MS);
  const codeHash = await hashCredentialSecret(credential.secret);

  try {
    const db = await getWorkspaceDatabase();
    await db.batch([
      db
        .prepare(
          `UPDATE device_pairings
           SET revoked_at = ?1
           WHERE owner_id = ?2
             AND redeemed_at IS NULL
             AND revoked_at IS NULL`,
        )
        .bind(now.toISOString(), ownerId),
      db
        .prepare(
          `INSERT INTO device_pairings (
            id, owner_id, code_hash, device_name,
            expires_at, redeemed_at, revoked_at, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6)`,
        )
        .bind(
          credential.id,
          ownerId,
          codeHash,
          deviceName,
          expiresAt.toISOString(),
          now.toISOString(),
        ),
    ]);

    return privateJson(
      {
        deepLink: buildPairingDeepLink({
          baseUrl: new URL(request.url).origin,
          code: credential.code,
          dispatchToken,
        }),
        pairingId: credential.id,
        expiresAt: expiresAt.toISOString(),
      },
      201,
    );
  } catch {
    return apiError(503, "PAIRING_UNAVAILABLE", "暂时无法创建 App 配对，请稍后重试");
  }
}

function sameOriginBrowserRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
