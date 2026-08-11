import {
  activityStatement,
  apiError,
  customerBusinessLicenseObjectKey,
  findOwnedCustomer,
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
  privateJson,
} from "@/lib/workspace/server";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const owned = await ownedCustomer(request, context);
  if (!owned?.row.business_license_key) {
    return apiError(404, "BUSINESS_LICENSE_NOT_FOUND", "未找到营业执照图片");
  }
  const { files } = await getWorkspaceBindings();
  const object = await files.get(owned.row.business_license_key);
  if (!object) return apiError(404, "BUSINESS_LICENSE_NOT_FOUND", "未找到营业执照图片");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(object.body, { status: 200, headers });
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const owned = await ownedCustomer(request, context);
  if (!owned) return apiError(404, "CUSTOMER_NOT_FOUND", "未找到客户");
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return apiError(415, "BUSINESS_LICENSE_FORM_REQUIRED", "请使用图片上传表单");
  }
  let file: File;
  try {
    const form = (await request.formData()) as unknown as FormData;
    const value = form.get("businessLicense");
    if (
      !(value instanceof File) ||
      value.size <= 0 ||
      value.size > MAX_IMAGE_BYTES ||
      !ALLOWED_IMAGE_TYPES.has(value.type.toLowerCase())
    ) {
      throw new Error("invalid file");
    }
    file = value;
  } catch {
    return apiError(400, "INVALID_BUSINESS_LICENSE", "请选择 10MB 以内的营业执照图片");
  }
  const { db, files } = await getWorkspaceBindings();
  const key = customerBusinessLicenseObjectKey(owned.userId, owned.row.id);
  try {
    await files.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
      customMetadata: {
        ownerId: owned.userId,
        customerId: owned.row.id,
        kind: "business-license",
      },
    });
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `UPDATE customers
           SET business_license_key = ?1, updated_at = ?2
           WHERE id = ?3 AND owner_id = ?4 AND deleted_at IS NULL`,
        )
        .bind(key, now, owned.row.id, owned.userId),
      activityStatement(db, {
        ownerId: owned.userId,
        customerId: owned.row.id,
        customerName: owned.row.name,
        eventType: "business_license_updated",
        summary: "营业执照图片已更新",
        createdAt: now,
      }),
    ]);
  } catch {
    return apiError(502, "BUSINESS_LICENSE_SAVE_FAILED", "营业执照保存失败，请稍后重试");
  }
  return privateJson({ uploaded: true, url: `/api/customers/${owned.row.id}/business-license` });
}

async function ownedCustomer(request: Request, context: RouteContext) {
  if (!(await isWorkspaceCloudConfigured())) return null;
  const { id: encodedId } = await context.params;
  try {
    return findOwnedCustomer(request, decodeURIComponent(encodedId).trim());
  } catch {
    return null;
  }
}
