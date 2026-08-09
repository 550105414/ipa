import {
  apiError,
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
  maskPhone,
  privateJson,
  workspaceUserId,
} from "@/lib/workspace/server";

type FollowUpRow = {
  id: string;
  name: string;
  phone: string;
  next_follow_up_at: string;
};

export async function GET(request: Request): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(409, "CLOUD_SYNC_REQUIRED", "跟进提醒需要启用云端同步");
  }
  const userId = workspaceUserId(request);
  if (!userId) return apiError(401, "AUTH_REQUIRED", "请先登录后再查看跟进提醒");
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const { db } = await getWorkspaceBindings();
  const rows = await db
    .prepare(
      `SELECT id, name, phone, next_follow_up_at
       FROM customers
       WHERE owner_id = ?1
         AND deleted_at IS NULL
         AND next_follow_up_at IS NOT NULL
         AND next_follow_up_at <= ?2
       ORDER BY next_follow_up_at ASC
       LIMIT 20`,
    )
    .bind(userId, todayEnd.toISOString())
    .all<FollowUpRow>();
  const count = await db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM customers
       WHERE owner_id = ?1
         AND deleted_at IS NULL
         AND next_follow_up_at IS NOT NULL
         AND next_follow_up_at <= ?2`,
    )
    .bind(userId, todayEnd.toISOString())
    .first<{ total: number }>();
  const items = (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    maskedPhone: maskPhone(row.phone),
    nextFollowUpAt: row.next_follow_up_at,
    overdue: row.next_follow_up_at < todayStart.toISOString(),
  }));
  return privateJson({
    totalDue: Number(count?.total ?? 0),
    overdue: items.filter((item) => item.overdue).length,
    items,
  });
}
