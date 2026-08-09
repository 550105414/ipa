import { getDemoCustomer } from "@/lib/search/demo";
import type {
  ApiErrorResponse,
  BankCardUpdateResponse,
} from "@/lib/search/types";
import {
  BankCardConfigurationError,
  encryptBankCardNumber,
  InvalidBankCardError,
  normalizeAndValidateCardNumber,
} from "@/lib/security/bank-card";
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
  activityStatement,
  apiError as workspaceApiError,
  findOwnedCustomer,
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
  privateJson,
} from "@/lib/workspace/server";

const MAX_JSON_BODY_LENGTH = 4096;
const ALLOWED_BODY_FIELDS = new Set(["password", "cardNumber"]);

interface BankCardUpdateRpcRow {
  last4: string;
}

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const id = await readCustomerId(context);
  if (!id) return accessDeniedResponse();

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request);
  } catch {
    return errorResponse(400, "INVALID_BANK_CARD_REQUEST", "银行卡请求格式无效");
  }

  if (await isWorkspaceCloudConfigured()) {
    const owned = await findOwnedCustomer(request, id);
    if (!owned) return accessDeniedResponse();
    let cardNumber: string;
    try {
      if (Object.keys(body).some((key) => !ALLOWED_BODY_FIELDS.has(key))) {
        throw new InvalidBankCardError();
      }
      cardNumber = normalizeAndValidateCardNumber(body.cardNumber);
    } catch {
      return workspaceApiError(400, "INVALID_BANK_CARD_NUMBER", "银行卡号应为 12～19 位数字");
    }
    try {
      const encrypted = await encryptBankCardNumber(cardNumber, id);
      const { db } = await getWorkspaceBindings();
      const now = new Date().toISOString();
      await db.batch([
        db.prepare(
          `UPDATE customers
           SET bank_card_ciphertext = ?1, bank_card_last4 = ?2, updated_at = ?3
           WHERE id = ?4 AND owner_id = ?5`,
        )
        .bind(
          encrypted.ciphertext,
          encrypted.last4,
          now,
          id,
          owned.userId,
        ),
        activityStatement(db, {
          ownerId: owned.userId,
          customerId: id,
          customerName: owned.row.name,
          eventType: "bank_card_updated",
          summary: `银行卡号已更新（尾号 ${encrypted.last4}）`,
          createdAt: now,
        }),
      ]);
      return privateJson<BankCardUpdateResponse>({ last4: encrypted.last4 });
    } catch {
      return workspaceApiError(502, "BANK_CARD_SERVICE_UNAVAILABLE", "银行卡保存失败，请稍后重试");
    }
  }

  let backend;
  try {
    backend = getSearchBackendConfig();
  } catch (error) {
    const message =
      error instanceof BackendConfigurationError
        ? error.message
        : "银行卡服务配置无效";
    return errorResponse(503, "BANK_CARD_SERVICE_NOT_CONFIGURED", message);
  }

  const demoCustomer = backend.mode === "demo" ? getDemoCustomer(id) : null;
  if (backend.mode === "demo") {
    if (!demoCustomer) return accessDeniedResponse();
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
    return errorResponse(503, "BANK_CARD_SERVICE_UNAVAILABLE", "银行卡服务暂时不可用");
  }
  if (!authorization.authorized) return accessDeniedResponse();

  let cardNumber: string;
  try {
    if (Object.keys(body).some((key) => !ALLOWED_BODY_FIELDS.has(key))) {
      throw new InvalidBankCardError();
    }
    cardNumber = normalizeAndValidateCardNumber(body.cardNumber);
  } catch {
    return errorResponse(
      400,
      "INVALID_BANK_CARD_NUMBER",
      "银行卡号格式或校验失败",
    );
  }

  let encrypted;
  try {
    encrypted = await encryptBankCardNumber(cardNumber, id);
  } catch (error) {
    if (error instanceof BankCardConfigurationError) {
      return errorResponse(503, "BANK_CARD_SERVICE_NOT_CONFIGURED", error.message);
    }
    return errorResponse(502, "BANK_CARD_SERVICE_UNAVAILABLE", "银行卡服务暂时不可用");
  }

  if (backend.mode === "demo") {
    if (!demoCustomer) return accessDeniedResponse();
    return jsonResponse<BankCardUpdateResponse>({
      last4: encrypted.last4,
      demoMode: true,
    });
  }

  try {
    const service = getSensitiveServiceConfig(backend);
    const rows = await callSensitiveServiceRpc<BankCardUpdateRpcRow[]>(
      service,
      "update_sales_workspace_customer_bank_card",
      {
        p_customer_id: id,
        p_bank_card_ciphertext: encrypted.ciphertext,
        p_bank_card_last4: encrypted.last4,
      },
    );
    if (!Array.isArray(rows)) throw new SupabaseRestError(502);
    const row = rows[0];
    if (!row) {
      recordSensitiveAccessFailure(authorization.rateLimitKey);
      return accessDeniedResponse();
    }
    return jsonResponse<BankCardUpdateResponse>({ last4: String(row.last4) });
  } catch (error) {
    if (error instanceof SensitiveServiceConfigurationError) {
      return errorResponse(503, "BANK_CARD_SERVICE_NOT_CONFIGURED", error.message);
    }
    if (error instanceof SupabaseRestError) {
      if (error.status === 401 || error.status === 403) {
        return errorResponse(503, "BANK_CARD_SERVICE_NOT_CONFIGURED", "银行卡服务尚未正确配置");
      }
      if (error.status === 404) {
        return errorResponse(503, "BANK_CARD_SERVICE_NOT_DEPLOYED", "银行卡服务尚未部署");
      }
      if (error.status === 504) {
        return errorResponse(504, "BANK_CARD_SERVICE_TIMEOUT", "银行卡服务响应超时");
      }
    }
    return errorResponse(502, "BANK_CARD_SERVICE_UNAVAILABLE", "银行卡服务暂时不可用");
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
