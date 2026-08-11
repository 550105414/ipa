import {
  isCustomerCallResult,
  type CustomerCallResult,
} from "@/lib/customers/profile";
import {
  activityStatement,
  apiError,
  findOwnedCustomer,
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
  privateJson,
} from "@/lib/workspace/server";

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(409, "CLOUD_SYNC_REQUIRED", "联系记录需要启用云端同步");
  }
  const { id: encodedId } = await context.params;
  let id = "";
  try {
    id = decodeURIComponent(encodedId).trim();
  } catch {
    return apiError(404, "CUSTOMER_NOT_FOUND", "未找到客户");
  }
  const owned = await findOwnedCustomer(request, id);
  if (!owned) return apiError(404, "CUSTOMER_NOT_FOUND", "未找到客户");
  let body: { result?: unknown; note?: unknown; nextFollowUpAt?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError(400, "INVALID_ACTIVITY", "联系记录无效");
  }
  if (!isCustomerCallResult(body.result)) {
    return apiError(400, "INVALID_CALL_RESULT", "请选择有效的联系结果");
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 300) return apiError(400, "INVALID_ACTIVITY_NOTE", "备注不能超过 300 个字符");
  let nextFollowUpAt = owned.row.next_follow_up_at;
  if (body.nextFollowUpAt === null || body.nextFollowUpAt === "") {
    nextFollowUpAt = null;
  } else if (typeof body.nextFollowUpAt === "string") {
    const parsed = new Date(body.nextFollowUpAt);
    if (Number.isNaN(parsed.getTime())) {
      return apiError(400, "INVALID_FOLLOW_UP_AT", "下次跟进时间无效");
    }
    nextFollowUpAt = parsed.toISOString();
  }
  const now = new Date().toISOString();
  const summary = callSummary(body.result, note);
  const { db } = await getWorkspaceBindings();
  await db.batch([
    db
      .prepare(
        `UPDATE customers
         SET next_follow_up_at = ?1, updated_at = ?2
         WHERE id = ?3 AND owner_id = ?4 AND deleted_at IS NULL`,
      )
      .bind(nextFollowUpAt, now, id, owned.userId),
    activityStatement(db, {
      ownerId: owned.userId,
      customerId: id,
      customerName: owned.row.name,
      eventType: "customer_contacted",
      summary,
      createdAt: now,
    }),
  ]);
  return privateJson({ result: body.result, summary, nextFollowUpAt, createdAt: now }, 201);
}

function callSummary(result: CustomerCallResult, note: string): string {
  const prefix = `联系结果：${result}`;
  return note ? `${prefix}；${note}` : prefix;
}
