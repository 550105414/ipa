const AUTHENTICATED_USER_HEADER = "oai-authenticated-user-id";
const AUTHENTICATED_EMAIL_HEADER = "oai-authenticated-user-email";

export class LocalVaultServerConfigurationError extends Error {
  constructor() {
    super("本机资料库服务尚未配置");
    this.name = "LocalVaultServerConfigurationError";
  }
}

export function localVaultAuthenticatedUserId(request: Request): string | null {
  // Sites always authenticates this owner-only workspace. The production
  // dispatcher currently forwards the verified email on every device, while
  // some browser paths omit the otherwise preferred stable user-id header.
  // Prefer the normalized, dispatcher-injected email so phone and desktop
  // resolve to the same private customer namespace; retain the user-id as a
  // fallback for non-Sites/local integrations.
  const injectedEmail = request.headers.get(AUTHENTICATED_EMAIL_HEADER)?.trim().toLowerCase();
  if (injectedEmail && injectedEmail.length <= 320) return `email:${injectedEmail}`;
  const injectedUserId = request.headers.get(AUTHENTICATED_USER_HEADER)?.trim();
  if (injectedUserId) return injectedUserId;
  try {
    const hostname = new URL(request.url).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return "local-development-user";
    }
  } catch {
    // Invalid request URLs are not granted a development identity.
  }
  if (process.env.LOCAL_VAULT_ALLOW_UNAUTHENTICATED === "true") {
    return "local-development-user";
  }
  return null;
}

export async function localVaultUserScope(userId: string): Promise<string> {
  return deriveScopedSecret(localVaultRootSecret(), `scope:v1:${userId}`);
}

export async function localVaultUnlockSecret(userId: string): Promise<string> {
  return deriveScopedSecret(localVaultRootSecret(), `unlock:v1:${userId}`);
}

function localVaultRootSecret(): Uint8Array {
  const configured = process.env.LOCAL_VAULT_UNLOCK_SECRET?.trim();
  if (!configured) throw new LocalVaultServerConfigurationError();
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(configured), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    throw new LocalVaultServerConfigurationError();
  }
  if (bytes.length !== 32) throw new LocalVaultServerConfigurationError();
  return bytes;
}

async function deriveScopedSecret(
  rootSecret: Uint8Array,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(rootSecret).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
  return bytesToBase64Url(signature);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
