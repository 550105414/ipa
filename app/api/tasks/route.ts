import {
  apiError,
  getWorkspaceBindings,
  isUuid,
  isWorkspaceCloudConfigured,
  privateJson,
  workspaceUserId,
} from "@/lib/workspace/server";

type TaskRow = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  title: string;
  due_at: string | null;
  status: "open" | "done";
  created_at: string;
  completed_at: string | null;
};

export async function GET(request: Request): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(409, "CLOUD_SYNC_REQUIRED", "待办需要启用云端同步");
  }
  const userId = workspaceUserId(request);
  if (!userId) return apiError(401, "AUTH_REQUIRED", "请先登录后再查看待办");
  const { db } = await getWorkspaceBindings();
  const rows = await db
    .prepare(
      `SELECT t.id, t.customer_id, c.name AS customer_name,
              t.title, t.due_at, t.status, t.created_at, t.completed_at
       FROM tasks t
       LEFT JOIN customers c
         ON c.id = t.customer_id AND c.owner_id = t.owner_id
       WHERE t.owner_id = ?1
       ORDER BY CASE WHEN t.status = 'open' THEN 0 ELSE 1 END,
                CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,
                t.due_at ASC,
                t.created_at DESC
       LIMIT 200`,
    )
    .bind(userId)
    .all<TaskRow>();
  return privateJson({ items: rows.results ?? [] });
}

export async function POST(request: Request): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(409, "CLOUD_SYNC_REQUIRED", "待办需要启用云端同步");
  }
  const userId = workspaceUserId(request);
  if (!userId) return apiError(401, "AUTH_REQUIRED", "请先登录后再新建待办");
  let body: { title?: unknown; dueAt?: unknown; customerId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError(400, "INVALID_TASK", "待办内容无效");
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 200) {
    return apiError(400, "INVALID_TASK_TITLE", "请输入 1～200 个字符的待办内容");
  }
  let dueAt: string | null = null;
  if (typeof body.dueAt === "string" && body.dueAt) {
    const parsed = new Date(body.dueAt);
    if (Number.isNaN(parsed.getTime())) {
      return apiError(400, "INVALID_TASK_DUE_AT", "待办时间无效");
    }
    dueAt = parsed.toISOString();
  }
  const customerId = typeof body.customerId === "string" && body.customerId
    ? body.customerId
    : null;
  const { db } = await getWorkspaceBindings();
  if (customerId) {
    if (!isUuid(customerId)) {
      return apiError(400, "INVALID_TASK_CUSTOMER", "关联客户无效");
    }
    const customer = await db
      .prepare("SELECT id FROM customers WHERE id = ?1 AND owner_id = ?2 LIMIT 1")
      .bind(customerId, userId)
      .first<{ id: string }>();
    if (!customer) return apiError(400, "INVALID_TASK_CUSTOMER", "关联客户无效");
  }
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO tasks (id, owner_id, customer_id, title, due_at, status, created_at, completed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, NULL)`,
    )
    .bind(id, userId, customerId, title, dueAt, createdAt)
    .run();
  return privateJson(
    {
      task: {
        id,
        customer_id: customerId,
        customer_name: null,
        title,
        due_at: dueAt,
        status: "open",
        created_at: createdAt,
        completed_at: null,
      },
    },
    201,
  );
}
