import type { ApiErrorResponse } from "@/lib/search/types";
import {
  authorizeSensitiveRequest,
  SensitiveAccessConfigurationError,
} from "@/lib/security/sensitive-access";
import {
  BackendConfigurationError,
  getSearchBackendConfig,
} from "@/lib/supabase/rest";
import {
  localVaultAuthenticatedUserId,
  localVaultUnlockSecret,
  localVaultUserScope,
} from "@/lib/security/local-vault-server";
import { isWorkspaceCloudConfigured } from "@/lib/workspace/server";

const MAX_BODY_BYTES = 2048;

export async function POST(request: Request): Promise<Response> {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return deniedResponse();

  let body: Record<string, unknown>;
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return deniedResponse();
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return deniedResponse();
    const parsed = JSON.parse(raw || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return deniedResponse();
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return deniedResponse();
  }
  if (Object.keys(body).some((key) => key !== "password")) {
    return deniedResponse();
  }

  if (await isWorkspaceCloudConfigured()) {
    return errorResponse(
      409,
      "LOCAL_VAULT_DISABLED",
      "当前已启用跨设备云端资料库",
    );
  }

  let backend;
  try {
    backend = getSearchBackendConfig();
  } catch (error) {
    return errorResponse(
      503,
      "LOCAL_VAULT_NOT_CONFIGURED",
      error instanceof BackendConfigurationError
        ? error.message
        : "本机资料库验证服务尚未配置",
    );
  }

  // The browser-local vault is the personal/demo fallback. A configured
  // Supabase deployment should keep using its authenticated create workflow.
  if (backend.mode !== "demo") {
    return errorResponse(
      409,
      "LOCAL_VAULT_DISABLED",
      "当前环境已连接客户数据库，无需启用本机资料库",
    );
  }

  const authenticatedUserId = localVaultAuthenticatedUserId(request);
  if (!authenticatedUserId) {
    return errorResponse(401, "SITE_SIGN_IN_REQUIRED", "请先通过 ChatGPT 登录本站");
  }

  try {
    const authorization = await authorizeSensitiveRequest(
      request,
      backend,
      body.password,
    );
    if (!authorization.authorized) return deniedResponse();
  } catch (error) {
    if (error instanceof SensitiveAccessConfigurationError) {
      return errorResponse(
        503,
        "LOCAL_VAULT_NOT_CONFIGURED",
        "本机资料库验证服务尚未配置",
      );
    }
    return errorResponse(503, "LOCAL_VAULT_UNAVAILABLE", "本机资料库验证暂时不可用");
  }

  let unlockSecret: string;
  let userScope: string;
  try {
    [unlockSecret, userScope] = await Promise.all([
      localVaultUnlockSecret(authenticatedUserId),
      localVaultUserScope(authenticatedUserId),
    ]);
  } catch {
    return errorResponse(
      503,
      "LOCAL_VAULT_NOT_CONFIGURED",
      "本机资料库验证服务尚未配置",
    );
  }

  return Response.json(
    { unlockSecret, userScope, expiresInSeconds: 300 },
    { status: 200, headers: sensitiveHeaders() },
  );
}

function deniedResponse(): Response {
  return errorResponse(401, "LOCAL_VAULT_ACCESS_DENIED", "验证密码错误");
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } } satisfies ApiErrorResponse,
    { status, headers: sensitiveHeaders() },
  );
}

function sensitiveHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    Vary: "Authorization",
  };
}
