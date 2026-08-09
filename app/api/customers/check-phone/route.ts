import {
  apiError,
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
  maskPhone,
  privateJson,
  workspaceUserId,
} from "@/lib/workspace/server";

export async function POST(request: Request): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return privateJson({ duplicate: false });
  }
  const userId = workspaceUserId(request);
  if (!userId) return apiError(401, "AUTH_REQUIRED", "请先登录后再检查手机号");
  let body: { phone?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError(400, "INVALID_PHONE_CHECK", "手机号检查请求无效");
  }
  const phone = normalizePhone(body.phone);
  if (!/^\+?\d{7,20}$/.test(phone)) {
    return apiError(400, "INVALID_CUSTOMER_PHONE", "请输入有效手机号");
  }
  const { db } = await getWorkspaceBindings();
  const row = await db
    .prepare(
      `SELECT id, name, phone, deleted_at
       FROM customers
       WHERE owner_id = ?1 AND phone = ?2
       LIMIT 1`,
    )
    .bind(userId, phone)
    .first<{ id: string; name: string; phone: string; deleted_at: string | null }>();
  return privateJson(
    row
      ? {
          duplicate: true,
          customer: {
            id: row.id,
            name: row.name,
            maskedPhone: maskPhone(row.phone),
            inTrash: Boolean(row.deleted_at),
          },
        }
      : { duplicate: false },
  );
}

function normalizePhone(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return `${trimmed.startsWith("+") ? "+" : ""}${trimmed.replace(/\D/g, "")}`;
}
