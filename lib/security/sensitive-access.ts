import type { SearchBackendConfig } from "@/lib/supabase/rest";
import { getEndUserBearerToken } from "@/lib/supabase/rest";

const PASSWORD_MAX_LENGTH = 256;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 5;
const MAX_TRACKED_KEYS = 1_000;

interface FailureWindow {
  failures: number;
  expiresAt: number;
}

const failureWindows = new Map<string, FailureWindow>();

export class SensitiveAccessConfigurationError extends Error {
  constructor() {
    super("敏感资料访问服务尚未配置");
    this.name = "SensitiveAccessConfigurationError";
  }
}

export type SensitiveAuthorizationResult =
  | {
      authorized: true;
      userAccessToken: string | null;
      rateLimitKey: string;
    }
  | { authorized: false };

export async function authorizeSensitiveRequest(
  request: Request,
  backend: SearchBackendConfig,
  candidatePassword: unknown,
): Promise<SensitiveAuthorizationResult> {
  assertSensitiveAccessConfigured();

  const userAccessToken =
    backend.mode === "supabase"
      ? getEndUserBearerToken(request, backend.anonKey)
      : null;
  if (backend.mode === "supabase" && !userAccessToken) {
    return { authorized: false };
  }

  const stableUserId = userAccessToken
    ? readJwtSubject(userAccessToken) ?? userAccessToken
    : "demo-mode";
  const rateLimitKey = await sensitiveRateLimitKey(
    `${stableUserId}|${clientAddress(request)}`,
  );
  const rateLimited = isSensitiveAccessRateLimited(rateLimitKey);
  // Keep doing the digest comparison while rate limited so response timing does
  // not become a separate password oracle.
  const passwordMatches =
    await verifySensitiveAccessPassword(candidatePassword);
  if (rateLimited || !passwordMatches) {
    if (!rateLimited) recordSensitiveAccessFailure(rateLimitKey);
    return { authorized: false };
  }

  clearSensitiveAccessFailures(rateLimitKey);
  return { authorized: true, userAccessToken, rateLimitKey };
}

export function assertSensitiveAccessConfigured(): void {
  configuredPassword();
}

export async function verifySensitiveAccessPassword(
  candidate: unknown,
): Promise<boolean> {
  const expected = configuredPassword();
  const supplied =
    typeof candidate === "string" && candidate.length <= PASSWORD_MAX_LENGTH
      ? candidate
      : "";

  const [expectedDigest, suppliedDigest] = await Promise.all([
    sha256(expected),
    sha256(supplied),
  ]);
  let difference = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= expectedDigest[index] ^ suppliedDigest[index];
  }
  return difference === 0;
}

export async function sensitiveRateLimitKey(
  userAccessToken: string,
): Promise<string> {
  const digest = await sha256(userAccessToken);
  const tokenFingerprint = Array.from(digest.slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  // The primary window is user-global, so rotating customer UUIDs cannot reset
  // password attempts. Routes still perform a customer-specific RLS preflight.
  return `${tokenFingerprint}:all-customers`;
}

export function isSensitiveAccessRateLimited(key: string): boolean {
  pruneExpiredWindows();
  const window = failureWindows.get(key);
  return Boolean(
    window &&
      window.expiresAt > Date.now() &&
      window.failures >= MAX_FAILURES_PER_WINDOW,
  );
}

export function recordSensitiveAccessFailure(key: string): void {
  const now = Date.now();
  const current = failureWindows.get(key);
  if (!current || current.expiresAt <= now) {
    failureWindows.set(key, {
      failures: 1,
      expiresAt: now + FAILURE_WINDOW_MS,
    });
  } else {
    current.failures += 1;
  }

  if (failureWindows.size > MAX_TRACKED_KEYS) {
    const oldestKey = failureWindows.keys().next().value as string | undefined;
    if (oldestKey) failureWindows.delete(oldestKey);
  }
}

export function clearSensitiveAccessFailures(key: string): void {
  failureWindows.delete(key);
}

function configuredPassword(): string {
  const value = process.env.SENSITIVE_VIEW_PASSWORD;
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > PASSWORD_MAX_LENGTH
  ) {
    throw new SensitiveAccessConfigurationError();
  }
  return value;
}

async function sha256(value: string): Promise<Uint8Array> {
  const result = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return new Uint8Array(result);
}

function pruneExpiredWindows(): void {
  const now = Date.now();
  for (const [key, window] of failureWindows) {
    if (window.expiresAt <= now) failureWindows.delete(key);
  }
}

function readJwtSubject(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    ) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub.length <= 128
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  const value =
    request.headers.get("cf-connecting-ip") ??
    forwarded ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 64
    ? normalized
    : "unknown";
}
