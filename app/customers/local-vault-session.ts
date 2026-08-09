import {
  createLocalVaultSession,
  isLocalVaultSessionActive,
  revokeLocalVaultSession,
  type LocalVaultScope,
  type LocalVaultSession,
} from "@/lib/local-vault";
import { apiErrorMessage, customerRequestHeaders } from "./request";

export type RememberedLocalVaultSession = {
  session: LocalVaultSession;
  userScope: string;
  expiresAt: number;
};

type UnlockResponse = {
  unlockSecret?: unknown;
  userScope?: unknown;
  expiresInSeconds?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
  };
};

type ScopeResponse = {
  userScope?: unknown;
};

let rememberedSession: RememberedLocalVaultSession | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let rememberedScope: (LocalVaultScope & { authKey: string }) | null = null;

export class LocalVaultUnlockRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "LocalVaultUnlockRequestError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Returns the non-sensitive IndexedDB namespace for the current signed-in user.
 * It intentionally does not unlock the vault or retain a password/secret.
 */
export async function getLocalVaultScope(
  signal?: AbortSignal,
): Promise<LocalVaultScope | null> {
  const headers = customerRequestHeaders();
  const authKey = headers.get("Authorization");
  if (authKey && rememberedScope?.authKey === authKey) {
    return { userScope: rememberedScope.userScope };
  }

  const response = await fetch("/api/local-vault/scope", {
    method: "GET",
    headers,
    cache: "no-store",
    signal,
  });
  // A configured cloud database deliberately disables the browser vault.
  if (response.status === 409) return null;

  const payload = (await response.json().catch(() => null)) as
    | ScopeResponse
    | null;
  if (!response.ok) {
    throw new Error(
      apiErrorMessage(payload, "暂时无法读取本机客户资料。"),
    );
  }
  if (typeof payload?.userScope !== "string" || !payload.userScope) {
    throw new Error("本机资料库范围响应无效。");
  }

  // Without a client-visible identity token the hosting layer may still
  // inject its own account header. Re-fetch in that case so an in-place
  // account switch can never reuse the previous user's namespace.
  rememberedScope = authKey
    ? { userScope: payload.userScope, authKey }
    : null;
  return { userScope: payload.userScope };
}

export function clearRememberedLocalVaultScope(): void {
  rememberedScope = null;
}

export async function unlockLocalVaultSession(
  password: string,
  signal?: AbortSignal,
): Promise<RememberedLocalVaultSession> {
  const response = await fetch("/api/local-vault/unlock", {
    method: "POST",
    headers: customerRequestHeaders(true),
    body: JSON.stringify({ password }),
    cache: "no-store",
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | UnlockResponse
    | null;
  if (!response.ok) {
    const code =
      typeof payload?.error?.code === "string" ? payload.error.code : null;
    const message =
      response.status === 401 || response.status === 403
        ? "验证密码不正确。"
        : response.status === 409 && code === "LOCAL_VAULT_DISABLED"
          ? "当前已连接客户数据库，无需启用本机资料库。"
          : "本机资料库验证服务暂时不可用。";
    throw new LocalVaultUnlockRequestError(
      response.status,
      code,
      message,
    );
  }
  if (
    typeof payload?.unlockSecret !== "string" ||
    !payload.unlockSecret ||
    typeof payload.userScope !== "string" ||
    !payload.userScope
  ) {
    throw new Error("本机资料库验证响应无效。");
  }

  const configuredSeconds = Number(payload.expiresInSeconds);
  if (
    Number.isFinite(configuredSeconds) &&
    (configuredSeconds <= 0 || configuredSeconds > 300)
  ) {
    throw new Error("本机资料库会话期限无效。");
  }
  const session = createLocalVaultSession({
    password,
    unlockSecret: payload.unlockSecret,
    userScope: payload.userScope,
  });
  if (rememberedSession) revokeLocalVaultSession(rememberedSession.session);
  rememberedSession = {
    session,
    userScope: payload.userScope,
    expiresAt: session.expiresAt,
  };
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => {
    if (rememberedSession?.session === session) {
      revokeLocalVaultSession(session);
    }
    rememberedSession = null;
    expiryTimer = null;
  }, Math.max(0, session.expiresAt - Date.now()) + 1);
  return rememberedSession;
}

export function getRememberedLocalVaultSession(): RememberedLocalVaultSession | null {
  if (!rememberedSession) return null;
  if (!isLocalVaultSessionActive(rememberedSession.session)) {
    clearRememberedLocalVaultSession();
    return null;
  }
  return rememberedSession;
}

export function clearRememberedLocalVaultSession(): void {
  if (rememberedSession) revokeLocalVaultSession(rememberedSession.session);
  rememberedSession = null;
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}
