const REQUEST_TIMEOUT_MS = 10_000;

export type SearchBackendConfig =
  | { mode: "demo" }
  | { mode: "supabase"; url: string; anonKey: string };

export class BackendConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendConfigurationError";
  }
}

export class SupabaseRestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Supabase RPC request failed with status ${status}`);
    this.name = "SupabaseRestError";
    this.status = status;
  }
}

export function getSearchBackendConfig(): SearchBackendConfig {
  const url = firstConfigured(
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const anonKey = firstConfigured(
    process.env.SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  if (!url && !anonKey) {
    if (process.env.SEARCH_DEMO_MODE?.toLowerCase() === "false") {
      throw new BackendConfigurationError("Supabase 搜索服务尚未配置");
    }
    return { mode: "demo" };
  }
  if (!url || !anonKey) {
    throw new BackendConfigurationError("Supabase URL 与 anon key 必须同时配置");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new BackendConfigurationError("Supabase URL 配置无效");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new BackendConfigurationError("Supabase URL 协议无效");
  }

  const configuredServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const keyRole = readJwtRole(anonKey);
  if (
    keyRole === "service_role" ||
    (configuredServiceRole && configuredServiceRole === anonKey)
  ) {
    throw new BackendConfigurationError("搜索 API 禁止使用 service role key");
  }

  return {
    mode: "supabase",
    url: parsedUrl.toString().replace(/\/$/, ""),
    anonKey,
  };
}

export function getEndUserBearerToken(
  request: Request,
  anonKey: string,
): string | null {
  const authorization = request.headers.get("authorization");
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization ?? "");
  if (!match) return null;

  const token = match[1];
  if (token.length > 8192 || token === anonKey) return null;

  const role = readJwtRole(token);
  if (role === "anon" || role === "service_role") return null;
  return token;
}

export async function callSupabaseRpc<T>(
  config: Extract<SearchBackendConfig, { mode: "supabase" }>,
  userAccessToken: string,
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${config.url}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
      {
        method: "POST",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${userAccessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        cache: "no-store",
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SupabaseRestError(504);
    }
    throw new SupabaseRestError(502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // Do not relay PostgREST's body: schema details and policy names are not part
    // of this public API. The status is enough for the route to map safely.
    await response.body?.cancel();
    throw new SupabaseRestError(response.status);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new SupabaseRestError(502);
  }
}

export async function verifySupabaseUserSession(
  config: Extract<SearchBackendConfig, { mode: "supabase" }>,
  userAccessToken: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${userAccessToken}`,
        Accept: "application/json",
      },
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

  try {
    const payload = (await response.json()) as { id?: unknown };
    if (
      typeof payload.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.id)
    ) {
      throw new SupabaseRestError(502);
    }
    return payload.id.toLowerCase();
  } catch (error) {
    if (error instanceof SupabaseRestError) throw error;
    throw new SupabaseRestError(502);
  }
}

function firstConfigured(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function readJwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}
