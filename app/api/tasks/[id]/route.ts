import {
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

async function taskIdentity(request: Request, context: RouteContext) {
  if (!(await isWorkspaceCloudConfigured())) return null;
  const userId = await workspaceUserId(request);
  const { id: encodedId } = await context.params;
  let id = "";
  try {
    id = decodeURIComponent(encodedId).trim();
  } catch {
    return null;
  }
  return userId && isUuid(id) ? { userId, id } : null;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const identity = await taskIdentity(request, context);
  if (!identity) return apiError(404, "TASK_NOT_FOUND", "未找到待办");
  let body: { status?: unknown; title?: unknown; dueAt?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError(400, "INVALID_TASK_UPDATE", "待办更新内容无效");
  }
  const { db } = await getWorkspaceBindings();
  const current = await db
    .prepare(
      `SELECT id, customer_id, title, due_at, status, created_at, completed_at
       FROM tasks WHERE id = ?1 AND owner_id = ?2 LIMIT 1`,
    )
    .bind(identity.id, identity.userId)
    .first<{
      id: string;
      customer_id: string | null;
      title: string;
      due_at: string | null;
      status: "open" | "done";
      created_at: string;
      completed_at: string | null;
    }>();
  if (!current) return apiError(404, "TASK_NOT_FOUND", "未找到待办");

  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
  const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
  const hasDueAt = Object.prototype.hasOwnProperty.call(body, "dueAt");
  if (!hasStatus && !hasTitle && !hasDueAt) {
    return apiError(400, "INVALID_TASK_UPDATE", "待办更新内容无效");
  }

  const status = hasStatus
    ? body.status === "done"
      ? "done"
      : body.status === "open"
        ? "open"
        : null
    : current.status;
  if (!status) return apiError(400, "INVALID_TASK_STATUS", "待办状态无效");

  const title = hasTitle && typeof body.title === "string" ? body.title.trim() : current.title;
  if (!title || title.length > 200) {
    return apiError(400, "INVALID_TASK_TITLE", "请输入 1～200 个字符的待办内容");
  }

  let dueAt = current.due_at;
  if (hasDueAt) {
    if (body.dueAt === null || body.dueAt === "") {
      dueAt = null;
    } else if (typeof body.dueAt === "string") {
      const parsed = new Date(body.dueAt);
      if (Number.isNaN(parsed.getTime())) {
        return apiError(400, "INVALID_TASK_DUE_AT", "待办时间无效");
      }
      dueAt = parsed.toISOString();
    } else {
      return apiError(400, "INVALID_TASK_DUE_AT", "待办时间无效");
    }
  }

  const completedAt =
    status === "done"
      ? current.status === "done"
        ? current.completed_at
        : new Date().toISOString()
      : null;
  const result = await db
    .prepare(
      `UPDATE tasks
       SET title = ?1, due_at = ?2, status = ?3, completed_at = ?4
       WHERE id = ?5 AND owner_id = ?6`,
    )
    .bind(title, dueAt, status, completedAt, identity.id, identity.userId)
    .run();
  if (!result.meta.changes) return apiError(404, "TASK_NOT_FOUND", "未找到待办");
  return privateJson({
    id: identity.id,
    status,
    completedAt,
    task: {
      id: identity.id,
      customer_id: current.customer_id,
      customer_name: null,
      title,
      due_at: dueAt,
      status,
      created_at: current.created_at,
      completed_at: completedAt,
    },
  });
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const identity = await taskIdentity(request, context);
  if (!identity) return apiError(404, "TASK_NOT_FOUND", "未找到待办");
  const { db } = await getWorkspaceBindings();
  const result = await db
    .prepare("DELETE FROM tasks WHERE id = ?1 AND owner_id = ?2")
    .bind(identity.id, identity.userId)
    .run();
  if (!result.meta.changes) return apiError(404, "TASK_NOT_FOUND", "未找到待办");
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "private, no-store" },
  });
}
