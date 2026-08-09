import type { SearchBackendConfig } from "@/lib/supabase/rest";
import { SupabaseRestError } from "@/lib/supabase/rest";

const REQUEST_TIMEOUT_MS = 10_000;

export interface SensitiveServiceConfig {
  url: string;
  serviceRoleKey: string;
  opaqueSecretKey: boolean;
}

export class SensitiveServiceConfigurationError extends Error {
  constructor() {
    super("敏感资料后端凭据尚未正确配置");
    this.name = "SensitiveServiceConfigurationError";
  }
}

export function getSensitiveServiceConfig(
  backend: Extract<SearchBackendConfig, { mode: "supabase" }>,
): SensitiveServiceConfig {
  // Fail if someone exposed a similarly named key to the client bundle, even
  // when the correct server-only variable is also present.
  if (process.env.NEXT_PUBLIC_SUPABASE_SENSITIVE_SERVICE_ROLE_KEY) {
    throw new SensitiveServiceConfigurationError();
  }

  const serviceRoleKey =
    process.env.SUPABASE_SENSITIVE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey || serviceRoleKey === backend.anonKey) {
    throw new SensitiveServiceConfigurationError();
  }

  const jwtRole = readJwtRole(serviceRoleKey);
  const isSupabaseSecretKey =
    /^sb_secret_[A-Za-z0-9_-]{20,}$/.test(serviceRoleKey);
  if (jwtRole !== "service_role" && !isSupabaseSecretKey) {
    throw new SensitiveServiceConfigurationError();
  }

  return {
    url: backend.url,
    serviceRoleKey,
    opaqueSecretKey: isSupabaseSecretKey,
  };
}

export async function callSensitiveServiceRpc<T>(
  config: SensitiveServiceConfig,
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await sensitiveServiceFetch(
    config,
    `${config.url}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
    args,
  );
  try {
    return (await response.json()) as T;
  } catch {
    throw new SupabaseRestError(502);
  }
}

export async function sensitiveServiceFetch(
  config: SensitiveServiceConfig,
  url: string,
  body: unknown,
): Promise<Response> {
  const target = new URL(url);
  const configuredOrigin = new URL(config.url).origin;
  if (target.origin !== configuredOrigin) throw new SupabaseRestError(502);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    const headers: Record<string, string> = {
      apikey: config.serviceRoleKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    // New sb_secret keys are opaque API keys and must not be sent as Bearer
    // JWTs. Legacy service_role keys are JWTs and use both headers.
    if (!config.opaqueSecretKey) {
      headers.Authorization = `Bearer ${config.serviceRoleKey}`;
    }
    response = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SupabaseRestError(504);
    }
    throw new SupabaseRestError(502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new SupabaseRestError(response.status);
  }
  return response;
}

function readJwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    ) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}
