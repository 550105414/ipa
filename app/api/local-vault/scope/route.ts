import {
  localVaultAuthenticatedUserId,
  localVaultUserScope,
} from "@/lib/security/local-vault-server";
import type { ApiErrorResponse } from "@/lib/search/types";
import {
  BackendConfigurationError,
  getSearchBackendConfig,
} from "@/lib/supabase/rest";
import { isWorkspaceCloudConfigured } from "@/lib/workspace/server";

export async function GET(request: Request): Promise<Response> {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return errorResponse(401, "SITE_SIGN_IN_REQUIRED", "请先登录本站");

  try {
    if (await isWorkspaceCloudConfigured()) {
      return errorResponse(409, "LOCAL_VAULT_DISABLED", "当前已启用跨设备云端资料库");
    }
    if (getSearchBackendConfig().mode !== "demo") {
      return errorResponse(409, "LOCAL_VAULT_DISABLED", "当前环境已连接客户数据库");
    }
  } catch (error) {
    return errorResponse(
      503,
      "LOCAL_VAULT_NOT_CONFIGURED",
      error instanceof BackendConfigurationError
        ? error.message
        : "本机资料库服务尚未配置",
    );
  }

  const userId = localVaultAuthenticatedUserId(request);
  if (!userId) return errorResponse(401, "SITE_SIGN_IN_REQUIRED", "请先通过 ChatGPT 登录本站");

  try {
    return Response.json(
      { userScope: await localVaultUserScope(userId) },
      { status: 200, headers: responseHeaders() },
    );
  } catch {
    return errorResponse(503, "LOCAL_VAULT_NOT_CONFIGURED", "本机资料库服务尚未配置");
  }
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } } satisfies ApiErrorResponse,
    { status, headers: responseHeaders() },
  );
}

function responseHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    Vary: "Authorization",
  };
}
