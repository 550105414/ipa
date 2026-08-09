import { getDemoCustomer } from "@/lib/search/demo";
import type {
  ApiErrorResponse,
  CustomerDetailResponse,
  ProfileStatus,
} from "@/lib/search/types";
import {
  BackendConfigurationError,
  callSupabaseRpc,
  getEndUserBearerToken,
  getSearchBackendConfig,
  SupabaseRestError,
} from "@/lib/supabase/rest";
import {
  activityStatement,
  apiError as workspaceApiError,
  findOwnedCustomer,
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
  maskPhone,
  normalizeCustomerCategory,
  privateJson,
  profileStatus,
} from "@/lib/workspace/server";
import {
  isCustomerMachineMode,
  isCustomerMachineType,
  isValidCustomerFeeRate,
} from "@/lib/customers/machine";

interface CustomerDetailRpcRow {
  id: string;
  name: string;
  masked_phone: string;
  profile_status: ProfileStatus;
  created_at: string | null;
  id_card_front_uploaded: boolean;
  id_card_back_uploaded: boolean;
}

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id: encodedId } = await context.params;
  let id: string;
  try {
    id = decodeURIComponent(encodedId).trim();
  } catch {
    return errorResponse(400, "INVALID_CUSTOMER_ID", "客户 ID 无效");
  }
  if (!isUuid(id)) {
    return errorResponse(400, "INVALID_CUSTOMER_ID", "客户 ID 无效");
  }

  if (await isWorkspaceCloudConfigured()) {
    const owned = await findOwnedCustomer(request, id);
    if (!owned) return workspaceApiError(404, "CUSTOMER_NOT_FOUND", "未找到客户");
    const { row } = owned;
    return privateJson<CustomerDetailResponse>({
      customer: {
        id: row.id,
        name: row.name,
        shopName: row.shop_name,
        maskedPhone: maskPhone(row.phone),
        profileStatus: profileStatus(row),
        category: normalizeCustomerCategory(row.category),
        nextFollowUpAt: row.next_follow_up_at,
        machineType: row.machine_type,
        machineMode: row.machine_mode,
        feeRate: row.fee_rate,
        createdAt: row.created_at,
        idCard: {
          frontUploaded: Boolean(row.id_card_front_key),
          backUploaded: Boolean(row.id_card_back_key),
        },
      },
    });
  }

  let backend;
  try {
    backend = getSearchBackendConfig();
  } catch (error) {
    const message =
      error instanceof BackendConfigurationError
        ? error.message
        : "客户服务配置无效";
    return errorResponse(503, "CUSTOMER_SERVICE_NOT_CONFIGURED", message);
  }

  if (backend.mode === "demo") {
    const customer = getDemoCustomer(id);
    if (!customer) {
      return errorResponse(404, "CUSTOMER_NOT_FOUND", "未找到客户");
    }
    return jsonResponse<CustomerDetailResponse>({
      customer,
      demoMode: true,
    });
  }

  const userAccessToken = getEndUserBearerToken(request, backend.anonKey);
  if (!userAccessToken) {
    return errorResponse(401, "AUTH_REQUIRED", "请先登录后再查看客户");
  }

  try {
    const rows = await callSupabaseRpc<CustomerDetailRpcRow[]>(
      backend,
      userAccessToken,
      "get_sales_workspace_customer",
      { p_customer_id: id },
    );
    if (!Array.isArray(rows)) throw new SupabaseRestError(502);
    const row = rows[0];
    if (!row) {
      // RLS-hidden records are deliberately indistinguishable from missing
      // records, so this endpoint cannot be used to probe customer existence.
      return errorResponse(404, "CUSTOMER_NOT_FOUND", "未找到客户");
    }

    return jsonResponse<CustomerDetailResponse>({
      customer: {
        id: String(row.id),
        name: row.name,
        maskedPhone: row.masked_phone,
        profileStatus:
          row.profile_status === "completed" ? "completed" : "draft",
        createdAt: row.created_at,
        idCard: {
          frontUploaded: Boolean(row.id_card_front_uploaded),
          backUploaded: Boolean(row.id_card_back_uploaded),
        },
      },
    });
  } catch (error) {
    return mapSupabaseError(error);
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id: encodedId } = await context.params;
  let id = "";
  try {
    id = decodeURIComponent(encodedId).trim();
  } catch {
    return workspaceApiError(400, "INVALID_CUSTOMER_ID", "客户 ID 无效");
  }
  if (!(await isWorkspaceCloudConfigured())) {
    return workspaceApiError(409, "CLOUD_SYNC_REQUIRED", "当前尚未启用云端客户同步");
  }
  const owned = await findOwnedCustomer(request, id);
  if (!owned) return workspaceApiError(404, "CUSTOMER_NOT_FOUND", "未找到客户");
  let body: {
    category?: unknown;
    nextFollowUpAt?: unknown;
    shopName?: unknown;
    machineType?: unknown;
    machineMode?: unknown;
    feeRate?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return workspaceApiError(400, "INVALID_CUSTOMER_UPDATE", "客户更新请求无效");
  }
  const updatesCategory = body.category !== undefined;
  const updatesFollowUp = body.nextFollowUpAt !== undefined;
  const updatesShopName = body.shopName !== undefined;
  const updatesMachine =
    body.machineType !== undefined || body.machineMode !== undefined || body.feeRate !== undefined;
  if (!updatesCategory && !updatesFollowUp && !updatesShopName && !updatesMachine) {
    return workspaceApiError(400, "INVALID_CUSTOMER_UPDATE", "没有需要保存的客户资料");
  }
  const category = updatesCategory
    ? normalizeCustomerCategory(body.category)
    : normalizeCustomerCategory(owned.row.category);
  if (updatesCategory && category !== body.category) {
    return workspaceApiError(400, "INVALID_CUSTOMER_CATEGORY", "客户分类无效");
  }
  let nextFollowUpAt = owned.row.next_follow_up_at;
  if (updatesFollowUp) {
    if (body.nextFollowUpAt === null || body.nextFollowUpAt === "") {
      nextFollowUpAt = null;
    } else if (typeof body.nextFollowUpAt === "string") {
      const parsed = new Date(body.nextFollowUpAt);
      if (Number.isNaN(parsed.getTime())) {
        return workspaceApiError(400, "INVALID_FOLLOW_UP_AT", "下次跟进时间无效");
      }
      nextFollowUpAt = parsed.toISOString();
    } else {
      return workspaceApiError(400, "INVALID_FOLLOW_UP_AT", "下次跟进时间无效");
    }
  }
  let shopName = owned.row.shop_name;
  if (updatesShopName) {
    if (body.shopName === null || body.shopName === "") {
      shopName = null;
    } else if (typeof body.shopName === "string") {
      shopName = body.shopName.trim();
      if (!shopName || shopName.length > 120) {
        return workspaceApiError(400, "INVALID_SHOP_NAME", "店铺名字不能超过 120 个字符");
      }
    } else {
      return workspaceApiError(400, "INVALID_SHOP_NAME", "店铺名字无效");
    }
  }
  let machineType = owned.row.machine_type;
  let machineMode = owned.row.machine_mode;
  let feeRate = owned.row.fee_rate;
  if (updatesMachine) {
    if (body.machineType === null || body.machineType === "") {
      machineType = null;
      machineMode = null;
      feeRate = null;
    } else {
      const nextRate = typeof body.feeRate === "number" ? body.feeRate : Number.NaN;
      if (
        !isCustomerMachineType(body.machineType) ||
        !isCustomerMachineMode(body.machineMode) ||
        !isValidCustomerFeeRate(nextRate)
      ) {
        return workspaceApiError(400, "INVALID_MACHINE_DETAILS", "请选择机器、购买方式并填写 0～100 之间的费率");
      }
      machineType = body.machineType;
      machineMode = body.machineMode;
      feeRate = nextRate;
    }
  }
  const { db } = await getWorkspaceBindings();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE customers
         SET category = ?1, next_follow_up_at = ?2, shop_name = ?3,
             machine_type = ?4, machine_mode = ?5, fee_rate = ?6, updated_at = ?7
         WHERE id = ?8 AND owner_id = ?9 AND deleted_at IS NULL`,
      )
      .bind(category, nextFollowUpAt, shopName, machineType, machineMode, feeRate, now, id, owned.userId),
    activityStatement(db, {
      ownerId: owned.userId,
      customerId: id,
      customerName: owned.row.name,
      eventType: updatesMachine
        ? "machine_updated"
        : updatesShopName
        ? "shop_name_updated"
        : updatesFollowUp
          ? "follow_up_updated"
          : "category_updated",
      summary: updatesMachine
        ? machineType && machineMode && feeRate !== null
          ? `机器更新为 ${machineType} · ${machineMode} · ${feeRate}%`
          : "已清空机器信息"
        : updatesShopName
        ? shopName
          ? `店铺名字更新为“${shopName}”`
          : "已清空店铺名字"
        : updatesFollowUp
        ? nextFollowUpAt
          ? `下次跟进时间更新为 ${nextFollowUpAt}`
          : "已清除下次跟进时间"
        : `客户分类更新为 ${category}`,
      createdAt: now,
    }),
  ]);
  return privateJson({
    category,
    nextFollowUpAt,
    shopName,
    machineType,
    machineMode,
    feeRate,
  });
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id: encodedId } = await context.params;
  let id = "";
  try {
    id = decodeURIComponent(encodedId).trim();
  } catch {
    return workspaceApiError(404, "CUSTOMER_NOT_FOUND", "未找到客户");
  }
  if (!(await isWorkspaceCloudConfigured())) {
    return workspaceApiError(409, "CLOUD_SYNC_REQUIRED", "当前尚未启用云端客户同步");
  }
  const owned = await findOwnedCustomer(request, id);
  if (!owned) return workspaceApiError(404, "CUSTOMER_NOT_FOUND", "未找到客户");
  const { db } = await getWorkspaceBindings();
  const deletedAt = new Date();
  const purgeAfter = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  await db.batch([
    db.prepare("UPDATE tasks SET customer_id = NULL WHERE customer_id = ?1 AND owner_id = ?2").bind(id, owned.userId),
    db
      .prepare(
        `UPDATE customers
         SET deleted_at = ?1, purge_after = ?2, updated_at = ?1
         WHERE id = ?3 AND owner_id = ?4 AND deleted_at IS NULL`,
      )
      .bind(deletedAt.toISOString(), purgeAfter.toISOString(), id, owned.userId),
    activityStatement(db, {
      ownerId: owned.userId,
      customerId: id,
      customerName: owned.row.name,
      eventType: "customer_trashed",
      summary: "客户已移入回收站，将保留 30 天",
      createdAt: deletedAt.toISOString(),
    }),
  ]);
  return privateJson({ deletedAt: deletedAt.toISOString(), purgeAfter: purgeAfter.toISOString() });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function mapSupabaseError(error: unknown): Response {
  if (!(error instanceof SupabaseRestError)) {
    return errorResponse(502, "CUSTOMER_SERVICE_UNAVAILABLE", "客户服务暂时不可用");
  }
  if (error.status === 401) {
    return errorResponse(401, "AUTH_EXPIRED", "登录已过期，请重新登录");
  }
  if (error.status === 403) {
    return errorResponse(403, "CUSTOMER_FORBIDDEN", "当前账号无权查看该客户");
  }
  if (error.status === 404) {
    return errorResponse(503, "CUSTOMER_SERVICE_NOT_DEPLOYED", "客户服务尚未部署");
  }
  if (error.status === 504) {
    return errorResponse(504, "CUSTOMER_SERVICE_TIMEOUT", "客户服务响应超时");
  }
  return errorResponse(502, "CUSTOMER_SERVICE_UNAVAILABLE", "客户服务暂时不可用");
}

function jsonResponse<T>(body: T, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      Vary: "Authorization",
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse<ApiErrorResponse>({ error: { code, message } }, status);
}
