import { localVaultAuthenticatedUserId } from "@/lib/security/local-vault-server";
import {
  apiError,
  getWorkspaceDatabase,
  privateJson,
} from "@/lib/workspace/server";

const TOKEN_ID_PATTERN = /^[0-9a-f]{32}$/;

export async function GET(request: Request): Promise<Response> {
  const ownerId = localVaultAuthenticatedUserId(request);
  if (!ownerId) return apiError(401, "AUTH_REQUIRED", "请先登录后再管理已绑定设备");

  try {
    const db = await getWorkspaceDatabase();
    const result = await db
      .prepare(
        `SELECT id, device_name, created_at, last_used_at
         FROM device_tokens
         WHERE owner_id = ?1 AND revoked_at IS NULL
         ORDER BY created_at DESC
         LIMIT 20`,
      )
      .bind(ownerId)
      .all<{
        id: string;
        device_name: string | null;
        created_at: string;
        last_used_at: string | null;
      }>();
    return privateJson({ devices: result.results ?? [] });
  } catch {
    return apiError(503, "DEVICE_LIST_UNAVAILABLE", "暂时无法读取已绑定设备");
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return apiError(403, "DEVICE_REVOKE_DENIED", "无法解除此设备绑定");
  }
  const ownerId = localVaultAuthenticatedUserId(request);
  if (!ownerId) return apiError(401, "AUTH_REQUIRED", "请先登录后再解除设备绑定");

  let tokenId: string;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "tokenId") ||
      typeof body.tokenId !== "string" ||
      !TOKEN_ID_PATTERN.test(body.tokenId)
    ) {
      throw new Error("invalid body");
    }
    tokenId = body.tokenId;
  } catch {
    return apiError(400, "INVALID_DEVICE_TOKEN", "设备标识无效");
  }

  try {
    const db = await getWorkspaceDatabase();
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        `UPDATE device_tokens
         SET revoked_at = ?1
         WHERE id = ?2 AND owner_id = ?3 AND revoked_at IS NULL`,
      )
      .bind(now, tokenId, ownerId)
      .run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      return apiError(404, "DEVICE_NOT_FOUND", "未找到该绑定设备");
    }
    return privateJson({ revoked: true });
  } catch {
    return apiError(503, "DEVICE_REVOKE_UNAVAILABLE", "暂时无法解除设备绑定");
  }
}
