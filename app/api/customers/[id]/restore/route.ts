import {
  activityStatement,
  apiError,
  getWorkspaceBindings,
  isUuid,
  isWorkspaceCloudConfigured,
  privateJson,
  workspaceUserId,
} from "@/lib/workspace/server";

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(409, "CLOUD_SYNC_REQUIRED", "恢复客户需要启用云端同步");
  }
  const userId = workspaceUserId(request);
  const { id: rawId } = await context.params;
  const id = decodeURIComponent(rawId).trim();
  if (!userId || !isUuid(id)) return apiError(404, "CUSTOMER_NOT_FOUND", "未找到客户");
  const { db } = await getWorkspaceBindings();
  const row = await db
    .prepare("SELECT name FROM customers WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NOT NULL LIMIT 1")
    .bind(id, userId)
    .first<{ name: string }>();
  if (!row) return apiError(404, "CUSTOMER_NOT_FOUND", "未找到客户");
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("UPDATE customers SET deleted_at = NULL, purge_after = NULL, updated_at = ?1 WHERE id = ?2 AND owner_id = ?3")
      .bind(now, id, userId),
    activityStatement(db, {
      ownerId: userId,
      customerId: id,
      customerName: row.name,
      eventType: "customer_restored",
      summary: "客户已从回收站恢复",
      createdAt: now,
    }),
  ]);
  return privateJson({ id, restoredAt: now });
}
