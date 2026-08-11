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
  const userId = await workspaceUserId(request);
  if (!userId) return apiError(401, "AUTH_REQUIRED", "请先登录后再查看待办");
  const { db } = await getWorkspaceBindings();
  const url = new URL(request.url);
  const pageSizeValue = url.searchParams.get("pageSize");
  if (pageSizeValue !== null) {
    const requestedPageSize = Number(pageSizeValue);
    if (!Number.isInteger(requestedPageSize) || requestedPageSize < 1) {
      return apiError(400, "INVALID_PAGE_SIZE", "分页数量无效");
    }
    const pageSize = Math.min(requestedPageSize, 200);
    const cursor = url.searchParams.get("cursor")?.trim() || null;
    if (cursor && !isUuid(cursor)) {
      return apiError(400, "INVALID_CURSOR", "分页游标无效");
    }
    const page = await db
      .prepare(
        `SELECT t.id, t.customer_id, c.name AS customer_name,
                t.title, t.due_at, t.status, t.created_at, t.completed_at
         FROM tasks t
         LEFT JOIN customers c
           ON c.id = t.customer_id AND c.owner_id = t.owner_id
         WHERE t.owner_id = ?1
           AND (?2 IS NULL OR t.id > ?2)
         ORDER BY t.id ASC
         LIMIT ?3`,
      )
      .bind(userId, cursor, pageSize + 1)
      .all<TaskRow>();
    const pageRows = page.results ?? [];
    const hasMore = pageRows.length > pageSize;
    const items = hasMore ? pageRows.slice(0, pageSize) : pageRows;
    return privateJson({
      items,
      nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
    });
  }
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
  const userId = await workspaceUserId(request);
  if (!userId) return apiError(401, "AUTH_REQUIRED", "请先登录后再新建待办");
  let body: { title?: unknown; dueAt?: unknown; customerId?: unknown; status?: unknown };
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
  const status = body.status === undefined
    ? "open"
    : body.status === "done"
      ? "done"
      : body.status === "open"
        ? "open"
        : null;
  if (!status) return apiError(400, "INVALID_TASK_STATUS", "待办状态无效");
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
  const completedAt = status === "done" ? createdAt : null;
  await db
    .prepare(
      `INSERT INTO tasks (id, owner_id, customer_id, title, due_at, status, created_at, completed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(id, userId, customerId, title, dueAt, status, createdAt, completedAt)
    .run();
  return privateJson(
    {
      task: {
        id,
        customer_id: customerId,
        customer_name: null,
        title,
        due_at: dueAt,
        status,
        created_at: createdAt,
        completed_at: completedAt,
      },
    },
    201,
  );
}
