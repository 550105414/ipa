import { getDemoSensitiveCustomer } from "@/lib/search/demo";
import type {
  ApiErrorResponse,
  CustomerPhoneResponse,
} from "@/lib/search/types";
import {
  authorizeSensitiveRequest,
  recordSensitiveAccessFailure,
  SensitiveAccessConfigurationError,
} from "@/lib/security/sensitive-access";
import {
  BackendConfigurationError,
  getSearchBackendConfig,
  SupabaseRestError,
} from "@/lib/supabase/rest";
import { preflightCustomerVisibility } from "@/lib/supabase/customer-visibility";
import {
  callSensitiveServiceRpc,
  getSensitiveServiceConfig,
  SensitiveServiceConfigurationError,
} from "@/lib/supabase/sensitive-service";
import {
  findOwnedCustomer,
  isWorkspaceCloudConfigured,
  privateJson,
} from "@/lib/workspace/server";

const MAX_JSON_BODY_LENGTH = 2048;

interface CustomerSensitiveRpcRow {
  phone: string;
}

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const id = await readCustomerId(context);
  if (!id) return accessDeniedResponse();

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request);
  } catch {
    return accessDeniedResponse();
  }
  if (Object.keys(body).some((key) => key !== "password")) {
    return accessDeniedResponse();
  }

  if (await isWorkspaceCloudConfigured()) {
    const owned = await findOwnedCustomer(request, id);
    if (!owned) return accessDeniedResponse();
    return privateJson<CustomerPhoneResponse>({
      customerId: id,
      phone: owned.row.phone,
    });
  }

  let backend;
  try {
    backend = getSearchBackendConfig();
  } catch (error) {
    const message =
      error instanceof BackendConfigurationError
        ? error.message
        : "手机号服务配置无效";
    return errorResponse(503, "PHONE_SERVICE_NOT_CONFIGURED", message);
  }

  const demoSensitive =
    backend.mode === "demo" ? getDemoSensitiveCustomer(id) : null;
  if (backend.mode === "demo") {
    if (!demoSensitive) return accessDeniedResponse();
  } else {
    try {
      const visibility = await preflightCustomerVisibility(request, backend, id);
      if (!visibility.visible) return accessDeniedResponse();
    } catch (error) {
      return mapPreflightError(error);
    }
  }

  let authorization;
  try {
    authorization = await authorizeSensitiveRequest(
      request,
      backend,
      body.password,
    );
  } catch (error) {
    if (error instanceof SensitiveAccessConfigurationError) {
      return errorResponse(
        503,
        "SENSITIVE_PASSWORD_NOT_CONFIGURED",
        error.message,
      );
    }
    return errorResponse(503, "PHONE_SERVICE_UNAVAILABLE", "手机号服务暂时不可用");
  }
  if (!authorization.authorized) return accessDeniedResponse();

  if (backend.mode === "demo") {
    if (!demoSensitive) return accessDeniedResponse();
    return jsonResponse<CustomerPhoneResponse>({
      customerId: id,
      phone: demoSensitive.phone,
      demoMode: true,
    });
  }

  try {
    const service = getSensitiveServiceConfig(backend);
    const rows = await callSensitiveServiceRpc<CustomerSensitiveRpcRow[]>(
      service,
      "get_sales_workspace_customer_sensitive",
      { p_customer_id: id },
    );
    if (!Array.isArray(rows)) throw new SupabaseRestError(502);
    const row = rows[0];
    if (!row) {
      recordSensitiveAccessFailure(authorization.rateLimitKey);
      return accessDeniedResponse();
    }
    return jsonResponse<CustomerPhoneResponse>({
      customerId: id,
      phone: String(row.phone ?? ""),
    });
  } catch (error) {
    if (error instanceof SensitiveServiceConfigurationError) {
      return errorResponse(503, "PHONE_SERVICE_NOT_CONFIGURED", error.message);
    }
    if (error instanceof SupabaseRestError) {
      if (error.status === 401 || error.status === 403) {
        return errorResponse(503, "PHONE_SERVICE_NOT_CONFIGURED", "手机号服务尚未正确配置");
      }
      if (error.status === 404) {
        return errorResponse(503, "PHONE_SERVICE_NOT_DEPLOYED", "手机号服务尚未部署");
      }
      if (error.status === 504) {
        return errorResponse(504, "PHONE_SERVICE_TIMEOUT", "手机号服务响应超时");
      }
    }
    return errorResponse(502, "PHONE_SERVICE_UNAVAILABLE", "手机号服务暂时不可用");
  }
}

function mapPreflightError(error: unknown): Response {
  if (error instanceof SupabaseRestError) {
    if (error.status === 401 || error.status === 403) {
      return accessDeniedResponse();
    }
    if (error.status === 404) {
      return errorResponse(503, "CUSTOMER_PREFLIGHT_NOT_DEPLOYED", "客户权限服务尚未部署");
    }
    if (error.status === 504) {
      return errorResponse(504, "CUSTOMER_PREFLIGHT_TIMEOUT", "客户权限服务响应超时");
    }
  }
  return errorResponse(502, "CUSTOMER_PREFLIGHT_UNAVAILABLE", "客户权限服务暂时不可用");
}

async function readCustomerId(context: RouteContext): Promise<string | null> {
  const { id: encodedId } = await context.params;
  let id: string;
  try {
    id = decodeURIComponent(encodedId).trim().toLowerCase();
  } catch {
    return null;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    id,
  )
    ? id
    : null;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_LENGTH) {
    throw new Error("body too large");
  }
  const raw = await request.text();
  if (raw.length > MAX_JSON_BODY_LENGTH) throw new Error("body too large");
  const value = JSON.parse(raw || "{}");
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid body");
  }
  return value as Record<string, unknown>;
}

function accessDeniedResponse(): Response {
  return errorResponse(401, "SENSITIVE_ACCESS_DENIED", "敏感资料验证失败");
}

function jsonResponse<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: sensitiveHeaders() });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse<ApiErrorResponse>({ error: { code, message } }, status);
}

function sensitiveHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    Vary: "Authorization",
  };
}
