import { searchDemo } from "@/lib/search/demo";
import {
  encodeCursor,
  parseSearchInput,
  parseSearchParams,
  type SearchParams,
  SearchParamsError,
} from "@/lib/search/params";
import type {
  ApiErrorResponse,
  ProfileStatus,
  SearchItem,
  SearchResponse,
} from "@/lib/search/types";
import { parseStoredCustomerTags } from "@/lib/customers/profile";
import {
  BackendConfigurationError,
  callSupabaseRpc,
  getEndUserBearerToken,
  getSearchBackendConfig,
  SupabaseRestError,
} from "@/lib/supabase/rest";
import {
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
  maskPhone,
  normalizeCustomerCategory,
  privateJson,
  profileStatus,
  workspaceUserId,
  type WorkspaceCustomerRow,
} from "@/lib/workspace/server";

interface SearchRpcRow {
  kind: "customer" | "merchant";
  id: string;
  name: string | null;
  shop_name: string | null;
  masked_phone: string | null;
  profile_status: ProfileStatus | null;
  created_at: string | null;
  merchant_name: string | null;
  merchant_no: string | null;
  terminal_no: string | null;
  merchant_status: string | null;
}

const MAX_JSON_BODY_LENGTH = 4096;

export async function POST(request: Request): Promise<Response> {
  let params;
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_LENGTH) {
      return errorResponse(413, "SEARCH_BODY_TOO_LARGE", "搜索请求内容过大");
    }
    const body = await request.text();
    if (body.length > MAX_JSON_BODY_LENGTH) {
      return errorResponse(413, "SEARCH_BODY_TOO_LARGE", "搜索请求内容过大");
    }
    params = parseSearchInput(body === "" ? {} : JSON.parse(body));
  } catch (error) {
    if (error instanceof SearchParamsError) {
      return errorResponse(400, "INVALID_SEARCH_PARAMS", error.message);
    }
    return errorResponse(400, "INVALID_SEARCH_PARAMS", "搜索参数无效");
  }

  return handleSearch(request, params);
}

/**
 * Compatibility endpoint. New clients should use POST so phone fragments and
 * names do not enter URLs, browser history, referrers, or common access logs.
 */
export async function GET(request: Request): Promise<Response> {
  let params;
  try {
    params = parseSearchParams(new URL(request.url));
  } catch (error) {
    if (error instanceof SearchParamsError) {
      return errorResponse(400, "INVALID_SEARCH_PARAMS", error.message);
    }
    return errorResponse(400, "INVALID_SEARCH_PARAMS", "搜索参数无效");
  }
  return handleSearch(request, params);
}

async function handleSearch(
  request: Request,
  params: SearchParams,
): Promise<Response> {

  if (await isWorkspaceCloudConfigured()) {
    return handleWorkspaceSearch(request, params);
  }

  let backend;
  try {
    backend = getSearchBackendConfig();
  } catch (error) {
    const message =
      error instanceof BackendConfigurationError
        ? error.message
        : "搜索服务配置无效";
    return errorResponse(503, "SEARCH_NOT_CONFIGURED", message);
  }

  const fetchLimit = params.limit + 1;
  if (backend.mode === "demo") {
    const rows = searchDemo(params, fetchLimit);
    const hasMore = rows.length > params.limit;
    return jsonResponse<SearchResponse>({
      items: rows.slice(0, params.limit),
      nextCursor: hasMore
        ? encodeCursor(params.offset + params.limit)
        : null,
      demoMode: true,
    });
  }

  const userAccessToken = getEndUserBearerToken(request, backend.anonKey);
  if (!userAccessToken) {
    return errorResponse(401, "AUTH_REQUIRED", "请先登录后再搜索");
  }

  // An empty global query should not enumerate every visible record. The
  // customer-only scope intentionally allows it for the filterable list page.
  if (params.scope === "all" && params.query === "") {
    return jsonResponse<SearchResponse>({ items: [], nextCursor: null });
  }

  try {
    const rows = await callSupabaseRpc<SearchRpcRow[]>(
      backend,
      userAccessToken,
      "search_sales_workspace",
      {
        p_query: params.query,
        p_scope: params.scope,
        p_status: params.status,
        p_period: params.period,
        p_offset: params.offset,
        p_limit: fetchLimit,
      },
    );
    if (!Array.isArray(rows)) throw new SupabaseRestError(502);

    const hasMore = rows.length > params.limit;
    const items = rows.slice(0, params.limit).map(mapRpcRow);
    return jsonResponse<SearchResponse>({
      items,
      nextCursor: hasMore
        ? encodeCursor(params.offset + params.limit)
        : null,
    });
  } catch (error) {
    return mapSupabaseError(error);
  }
}

async function handleWorkspaceSearch(
  request: Request,
  params: SearchParams,
): Promise<Response> {
  const userId = workspaceUserId(request);
  if (!userId) return errorResponse(401, "AUTH_REQUIRED", "请先登录后再搜索");
  if (params.scope === "all" && params.query === "") {
    return privateJson<SearchResponse>({ items: [], nextCursor: null, total: 0 });
  }

  const { db } = await getWorkspaceBindings();
  const where: string[] = ["owner_id = ?", "deleted_at IS NULL"];
  const values: unknown[] = [userId];

  if (params.query) {
    const escaped = params.query.replace(/[\\%_]/g, "\\$&");
    const phoneFragment = params.query.replace(/\D/g, "");
    const nameIndex = values.length + 1;
    values.push(`%${escaped}%`);
    if (phoneFragment) {
      const phoneIndex = values.length + 1;
      values.push(`%${phoneFragment}%`);
      where.push(
        `(name LIKE ?${nameIndex} ESCAPE '\\' OR shop_name LIKE ?${nameIndex} ESCAPE '\\' OR address LIKE ?${nameIndex} ESCAPE '\\' OR tags_json LIKE ?${nameIndex} ESCAPE '\\' OR phone LIKE ?${phoneIndex} ESCAPE '\\')`,
      );
    } else {
      where.push(`(name LIKE ?${nameIndex} ESCAPE '\\' OR shop_name LIKE ?${nameIndex} ESCAPE '\\' OR address LIKE ?${nameIndex} ESCAPE '\\' OR tags_json LIKE ?${nameIndex} ESCAPE '\\')`);
    }
  }
  if (params.status === "completed") {
    where.push("id_card_front_key IS NOT NULL AND id_card_back_key IS NOT NULL");
  } else if (params.status === "draft") {
    where.push("(id_card_front_key IS NULL OR id_card_back_key IS NULL)");
  }
  if (params.category !== "all") {
    values.push(params.category);
    where.push(`category = ?${values.length}`);
  }
  const dateRange = searchDateRange(params.period);
  if (dateRange) {
    values.push(dateRange.start);
    where.push(`created_at >= ?${values.length}`);
    values.push(dateRange.end);
    where.push(`created_at < ?${values.length}`);
  }

  const predicate = where.join(" AND ");
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM customers WHERE ${predicate}`)
    .bind(...values)
    .first<{ total: number }>();
  const pageValues = [...values, params.limit + 1, params.offset];
  const rows = await db
    .prepare(
      `SELECT id, owner_id, name, phone, shop_name, category,
              machine_type, machine_mode, fee_rate, deposit_amount,
              address, tags_json, business_license_key,
              id_card_front_key, id_card_back_key,
              bank_card_ciphertext, bank_card_last4,
              next_follow_up_at, deleted_at, purge_after,
              created_at, updated_at
       FROM customers
       WHERE ${predicate}
       ORDER BY created_at DESC, id DESC
       LIMIT ?${values.length + 1} OFFSET ?${values.length + 2}`,
    )
    .bind(...pageValues)
    .all<WorkspaceCustomerRow>();
  const allRows = rows.results ?? [];
  const hasMore = allRows.length > params.limit;
  return privateJson<SearchResponse>({
    items: allRows.slice(0, params.limit).map((row: WorkspaceCustomerRow) => ({
      kind: "customer" as const,
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
      depositAmount: row.deposit_amount,
      address: row.address,
      tags: parseStoredCustomerTags(row.tags_json),
      createdAt: row.created_at,
    })),
    nextCursor: hasMore ? encodeCursor(params.offset + params.limit) : null,
    total: Number(countRow?.total ?? 0),
  });
}

function searchDateRange(
  period: SearchParams["period"],
): { start: string; end: string } | null {
  if (period === "all") return null;
  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (period === "this_month") {
    return {
      start: thisMonth.toISOString(),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    };
  }
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString(),
    end: thisMonth.toISOString(),
  };
}

function mapRpcRow(row: SearchRpcRow): SearchItem {
  if (row.kind === "customer") {
    return {
      kind: "customer",
      id: String(row.id),
      name: row.name?.trim() || "未命名客户",
      shopName: row.shop_name?.trim() || null,
      maskedPhone: row.masked_phone ?? "",
      profileStatus: row.profile_status === "completed" ? "completed" : "draft",
      createdAt: row.created_at,
    };
  }

  return {
    kind: "merchant",
    id: String(row.id),
    merchantName: row.merchant_name?.trim() || "未命名商户",
    merchantNo: row.merchant_no,
    terminalNo: row.terminal_no,
    merchantStatus: row.merchant_status,
    createdAt: row.created_at,
  };
}

function mapSupabaseError(error: unknown): Response {
  if (!(error instanceof SupabaseRestError)) {
    return errorResponse(502, "SEARCH_UNAVAILABLE", "搜索服务暂时不可用");
  }
  if (error.status === 401) {
    return errorResponse(401, "AUTH_EXPIRED", "登录已过期，请重新登录");
  }
  if (error.status === 403) {
    return errorResponse(403, "SEARCH_FORBIDDEN", "当前账号无搜索权限");
  }
  if (error.status === 404) {
    return errorResponse(503, "SEARCH_NOT_DEPLOYED", "搜索服务尚未部署");
  }
  if (error.status === 504) {
    return errorResponse(504, "SEARCH_TIMEOUT", "搜索超时，请稍后重试");
  }
  return errorResponse(502, "SEARCH_UNAVAILABLE", "搜索服务暂时不可用");
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
