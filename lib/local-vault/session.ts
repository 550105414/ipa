import {
  LocalVaultSessionExpiredError,
  LocalVaultSessionRevokedError,
  LocalVaultValidationError,
} from "./errors";
import { decodeUnlockSecret, validateUserScope } from "./crypto";
import type {
  LocalCustomerAccess,
  LocalVaultSession,
  LocalVaultSessionLifecycleOptions,
} from "./types";

const SESSION_LIFETIME_MS = 5 * 60 * 1000;

type SessionSecret = {
  password: string;
  unlockSecret: Uint8Array;
  userScope: string;
  expiresAt: number;
  revoked: boolean;
  objectUrls: Set<string>;
};

const sessionSecrets = new WeakMap<LocalVaultSession, SessionSecret>();

export function createLocalVaultSession(input: {
  password: string;
  unlockSecret: string;
  userScope: string;
}): LocalVaultSession {
  if (typeof input.password !== "string" || !input.password || input.password.length > 1024) {
    throw new LocalVaultValidationError("本机资料库密码无效。");
  }
  const userScope = validateUserScope(input.userScope);
  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  const session = Object.freeze({ userScope, expiresAt });
  sessionSecrets.set(session, {
    password: input.password,
    unlockSecret: decodeUnlockSecret(input.unlockSecret),
    userScope,
    expiresAt,
    revoked: false,
    objectUrls: new Set(),
  });
  return session;
}

export function isLocalVaultSessionActive(session: LocalVaultSession): boolean {
  const secret = sessionSecrets.get(session);
  return Boolean(secret && !secret.revoked && Date.now() < secret.expiresAt);
}

export function revokeLocalVaultSession(session: LocalVaultSession): void {
  const secret = sessionSecrets.get(session);
  if (!secret || secret.revoked) return;
  secret.revoked = true;
  for (const url of secret.objectUrls) URL.revokeObjectURL(url);
  secret.objectUrls.clear();
  secret.unlockSecret.fill(0);
  secret.password = "";
}

export function watchLocalVaultSessionLifecycle(
  session: LocalVaultSession,
  options: LocalVaultSessionLifecycleOptions = {},
): () => void {
  const windowTarget = options.windowTarget ?? (typeof window === "undefined" ? undefined : window);
  const documentTarget =
    options.documentTarget ?? (typeof document === "undefined" ? undefined : document);
  let notified = false;
  const check = () => {
    if (!isLocalVaultSessionActive(session) && !notified) {
      notified = true;
      revokeLocalVaultSession(session);
      options.onExpired?.();
    }
  };
  const onVisibility = () => {
    if (!documentTarget || documentTarget.visibilityState === "visible") check();
  };
  windowTarget?.addEventListener("focus", check);
  windowTarget?.addEventListener("pageshow", check);
  documentTarget?.addEventListener("visibilitychange", onVisibility);
  const remaining = Math.max(0, session.expiresAt - Date.now());
  const timer = setTimeout(check, remaining + 1);
  return () => {
    clearTimeout(timer);
    windowTarget?.removeEventListener("focus", check);
    windowTarget?.removeEventListener("pageshow", check);
    documentTarget?.removeEventListener("visibilitychange", onVisibility);
  };
}

export function revokeLocalCustomerAccess(access: Pick<LocalCustomerAccess, "revoke">): void {
  access.revoke();
}

export function requireSessionSecret(session: LocalVaultSession): SessionSecret {
  const secret = sessionSecrets.get(session);
  if (!secret || secret.revoked) throw new LocalVaultSessionRevokedError();
  if (Date.now() >= secret.expiresAt) {
    revokeLocalVaultSession(session);
    throw new LocalVaultSessionExpiredError();
  }
  return secret;
}

export function registerObjectUrls(session: LocalVaultSession, urls: string[]): () => void {
  const secret = requireSessionSecret(session);
  for (const url of urls) secret.objectUrls.add(url);
  let revoked = false;
  return () => {
    if (revoked) return;
    revoked = true;
    for (const url of urls) {
      URL.revokeObjectURL(url);
      secret.objectUrls.delete(url);
    }
  };
}
