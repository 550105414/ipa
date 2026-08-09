import {
  activityStatement,
  apiError,
  customerObjectKey,
  findOwnedCustomer,
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
  privateJson,
  profileStatus,
} from "@/lib/workspace/server";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(409, "CLOUD_SYNC_REQUIRED", "当前尚未启用云端客户同步");
  }
  const { id: encodedId } = await context.params;
  let id = "";
  try {
    id = decodeURIComponent(encodedId).trim();
  } catch {
    return apiError(400, "INVALID_CUSTOMER_ID", "客户 ID 无效");
  }
  const owned = await findOwnedCustomer(request, id);
  if (!owned) return apiError(404, "CUSTOMER_NOT_FOUND", "未找到客户");
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return apiError(415, "ID_CARD_FORM_REQUIRED", "请使用图片上传表单");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, "INVALID_ID_CARD_FORM", "身份证上传表单无效");
  }
  const front = readOptionalImage(form.get("idCardFront"));
  const back = readOptionalImage(form.get("idCardBack"));
  if (front === false || back === false) {
    return apiError(400, "INVALID_ID_CARD_IMAGE", "请上传 10MB 以内的 JPG、PNG 或 WebP 图片");
  }
  if (!front && !back) {
    return apiError(400, "ID_CARD_IMAGE_REQUIRED", "请至少选择一张身份证图片");
  }

  const { db, files } = await getWorkspaceBindings();
  const frontKey = front
    ? customerObjectKey(owned.userId, id, "front")
    : owned.row.id_card_front_key;
  const backKey = back
    ? customerObjectKey(owned.userId, id, "back")
    : owned.row.id_card_back_key;
  try {
    if (front && frontKey) {
      await files.put(frontKey, front.stream(), {
        httpMetadata: { contentType: front.type },
        customMetadata: { ownerId: owned.userId, customerId: id, side: "front" },
      });
    }
    if (back && backKey) {
      await files.put(backKey, back.stream(), {
        httpMetadata: { contentType: back.type },
        customMetadata: { ownerId: owned.userId, customerId: id, side: "back" },
      });
    }
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(
        `UPDATE customers
         SET id_card_front_key = ?1, id_card_back_key = ?2, updated_at = ?3
         WHERE id = ?4 AND owner_id = ?5`,
      )
      .bind(frontKey, backKey, now, id, owned.userId),
      activityStatement(db, {
        ownerId: owned.userId,
        customerId: id,
        customerName: owned.row.name,
        eventType: "id_card_updated",
        summary: `${front ? "身份证正面" : ""}${front && back ? "、" : ""}${back ? "身份证反面" : ""}已更新`,
        createdAt: now,
      }),
    ]);
  } catch {
    return apiError(502, "ID_CARD_SAVE_FAILED", "身份证图片保存失败，请稍后重试");
  }
  return privateJson({
    idCard: {
      frontUploaded: Boolean(frontKey),
      backUploaded: Boolean(backKey),
    },
    profileStatus: profileStatus({
      id_card_front_key: frontKey,
      id_card_back_key: backKey,
    }),
  });
}

function readOptionalImage(value: FormDataEntryValue | null): File | null | false {
  if (value === null || value === "") return null;
  if (!(value instanceof File) || value.size <= 0) return false;
  if (value.size > MAX_IMAGE_BYTES || !ALLOWED_IMAGE_TYPES.has(value.type)) return false;
  return value;
}
