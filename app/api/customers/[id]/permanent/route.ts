import {
  activityStatement,
  apiError,
  getWorkspaceBindings,
  isUuid,
  isWorkspaceCloudConfigured,
  workspaceUserId,
} from "@/lib/workspace/server";

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(409, "CLOUD_SYNC_REQUIRED", "彻底删除需要启用云端同步");
  }
  const userId = workspaceUserId(request);
  const { id: rawId } = await context.params;
  const id = decodeURIComponent(rawId).trim();
  if (!userId || !isUuid(id)) return apiError(404, "CUSTOMER_NOT_FOUND", "未找到客户");
  const { db, files } = await getWorkspaceBindings();
  const row = await db
    .prepare(
      `SELECT name, id_card_front_key, id_card_back_key
       FROM customers
       WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NOT NULL
       LIMIT 1`,
    )
    .bind(id, userId)
    .first<{ name: string; id_card_front_key: string | null; id_card_back_key: string | null }>();
  if (!row) return apiError(404, "CUSTOMER_NOT_FOUND", "未找到客户");
  await Promise.allSettled(
    [row.id_card_front_key, row.id_card_back_key]
      .filter((key): key is string => Boolean(key))
      .map((key) => files.delete(key)),
  );
  await db.batch([
    db.prepare("DELETE FROM customers WHERE id = ?1 AND owner_id = ?2").bind(id, userId),
    activityStatement(db, {
      ownerId: userId,
      customerId: id,
      customerName: row.name,
      eventType: "customer_deleted",
      summary: "客户已从回收站彻底删除",
    }),
  ]);
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
}
