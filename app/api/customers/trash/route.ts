import {
  activityStatement,
  apiError,
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
  maskPhone,
  normalizeCustomerCategory,
  privateJson,
  workspaceUserId,
} from "@/lib/workspace/server";

type TrashedRow = {
  id: string;
  name: string;
  phone: string;
  shop_name: string | null;
  category: string;
  id_card_front_key: string | null;
  id_card_back_key: string | null;
  deleted_at: string;
  purge_after: string;
};

export async function GET(request: Request): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(409, "CLOUD_SYNC_REQUIRED", "回收站需要启用云端同步");
  }
  const userId = workspaceUserId(request);
  if (!userId) return apiError(401, "AUTH_REQUIRED", "请先登录后再查看回收站");
  const { db, files } = await getWorkspaceBindings();
  await purgeExpired(db, files, userId);
  const rows = await db
    .prepare(
      `SELECT id, name, phone, shop_name, category, id_card_front_key, id_card_back_key,
              deleted_at, purge_after
       FROM customers
       WHERE owner_id = ?1 AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC
       LIMIT 200`,
    )
    .bind(userId)
    .all<TrashedRow>();
  return privateJson({
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      shopName: row.shop_name,
      maskedPhone: maskPhone(row.phone),
      category: normalizeCustomerCategory(row.category),
      deletedAt: row.deleted_at,
      purgeAfter: row.purge_after,
    })),
  });
}

async function purgeExpired(db: D1Database, files: R2Bucket, ownerId: string) {
  const rows = await db
    .prepare(
      `SELECT id, name, phone, shop_name, category, id_card_front_key, id_card_back_key,
              deleted_at, purge_after
       FROM customers
       WHERE owner_id = ?1 AND deleted_at IS NOT NULL AND purge_after <= ?2
       LIMIT 50`,
    )
    .bind(ownerId, new Date().toISOString())
    .all<TrashedRow>();
  for (const row of rows.results ?? []) {
    await Promise.allSettled(
      [row.id_card_front_key, row.id_card_back_key]
        .filter((key): key is string => Boolean(key))
        .map((key) => files.delete(key)),
    );
    await db.batch([
      db.prepare("DELETE FROM customers WHERE id = ?1 AND owner_id = ?2").bind(row.id, ownerId),
      activityStatement(db, {
        ownerId,
        customerId: row.id,
        customerName: row.name,
        eventType: "customer_purged",
        summary: "客户在回收站保留满 30 天后自动清除",
      }),
    ]);
  }
}
