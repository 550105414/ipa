import {
  apiError,
  getWorkspaceBindings,
  isUuid,
  isWorkspaceCloudConfigured,
  privateJson,
  workspaceUserId,
} from "@/lib/workspace/server";

type ActivityRow = {
  id: string;
  customer_id: string | null;
  customer_name: string;
  event_type: string;
  summary: string;
  created_at: string;
};

export async function GET(request: Request): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(409, "CLOUD_SYNC_REQUIRED", "操作记录需要启用云端同步");
  }
  const userId = await workspaceUserId(request);
  if (!userId) return apiError(401, "AUTH_REQUIRED", "请先登录后再查看操作记录");
  const customerId = new URL(request.url).searchParams.get("customerId")?.trim() ?? "";
  if (customerId && !isUuid(customerId)) {
    return apiError(400, "INVALID_CUSTOMER_ID", "客户 ID 无效");
  }
  const { db } = await getWorkspaceBindings();
  const statement = customerId
    ? db
        .prepare(
          `SELECT id, customer_id, customer_name, event_type, summary, created_at
           FROM customer_activity
           WHERE owner_id = ?1 AND customer_id = ?2
           ORDER BY created_at DESC
           LIMIT 200`,
        )
        .bind(userId, customerId)
    : db
        .prepare(
          `SELECT id, customer_id, customer_name, event_type, summary, created_at
           FROM customer_activity
           WHERE owner_id = ?1
           ORDER BY created_at DESC
           LIMIT 200`,
        )
        .bind(userId);
  const rows = await statement.all<ActivityRow>();
  return privateJson({ items: rows.results ?? [] });
}
