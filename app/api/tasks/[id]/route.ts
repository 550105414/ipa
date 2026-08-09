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
  const userId = workspaceUserId(request);
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
  let body: { status?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError(400, "INVALID_TASK_UPDATE", "待办更新内容无效");
  }
  const status = body.status === "done" ? "done" : body.status === "open" ? "open" : null;
  if (!status) return apiError(400, "INVALID_TASK_STATUS", "待办状态无效");
  const completedAt = status === "done" ? new Date().toISOString() : null;
  const { db } = await getWorkspaceBindings();
  const result = await db
    .prepare(
      "UPDATE tasks SET status = ?1, completed_at = ?2 WHERE id = ?3 AND owner_id = ?4",
    )
    .bind(status, completedAt, identity.id, identity.userId)
    .run();
  if (!result.meta.changes) return apiError(404, "TASK_NOT_FOUND", "未找到待办");
  return privateJson({ id: identity.id, status, completedAt });
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
