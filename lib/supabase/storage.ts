import { SupabaseRestError } from "@/lib/supabase/rest";
import type { SensitiveServiceConfig } from "@/lib/supabase/sensitive-service";
import { sensitiveServiceFetch } from "@/lib/supabase/sensitive-service";

const SIGNED_URL_TTL_SECONDS = 300;

export class StorageConfigurationError extends Error {
  constructor() {
    super("身份证图片存储服务尚未正确配置");
    this.name = "StorageConfigurationError";
  }
}

export class SupabaseStorageError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Supabase Storage request failed with status ${status}`);
    this.name = "SupabaseStorageError";
    this.status = status;
  }
}

export function getIdCardBucket(): string {
  const bucket = process.env.SUPABASE_ID_CARD_BUCKET?.trim();
  if (
    !bucket ||
    bucket.length > 100 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bucket)
  ) {
    throw new StorageConfigurationError();
  }
  return bucket;
}

export async function createSignedIdCardUrl(
  config: SensitiveServiceConfig,
  bucket: string,
  objectPath: string | null,
): Promise<string | null> {
  if (objectPath === null || objectPath.trim() === "") return null;
  const normalizedPath = normalizeObjectPath(objectPath);
  const encodedPath = normalizedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const endpoint = `${config.url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`;

  let response: Response;
  try {
    response = await sensitiveServiceFetch(config, endpoint, {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  } catch (error) {
    if (error instanceof SupabaseRestError) {
      throw new SupabaseStorageError(error.status);
    }
    throw new SupabaseStorageError(502);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SupabaseStorageError(502);
  }
  if (!isRecord(payload)) throw new SupabaseStorageError(502);
  const signedPath =
    typeof payload.signedURL === "string"
      ? payload.signedURL
      : typeof payload.signedUrl === "string"
        ? payload.signedUrl
        : null;
  if (!signedPath) throw new SupabaseStorageError(502);
  return absoluteSignedUrl(config.url, signedPath);
}

function normalizeObjectPath(value: string): string {
  const path = value.trim();
  if (
    path.length > 1024 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(path)
  ) {
    throw new SupabaseStorageError(502);
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        Array.from(segment).some((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint <= 31 || codePoint === 127;
        }),
    )
  ) {
    throw new SupabaseStorageError(502);
  }
  return segments.join("/");
}

function absoluteSignedUrl(supabaseUrl: string, value: string): string {
  const base = new URL(supabaseUrl);
  let signedUrl: URL;
  try {
    if (/^https?:\/\//i.test(value)) {
      signedUrl = new URL(value);
    } else if (value.startsWith("/storage/v1/")) {
      signedUrl = new URL(value, base.origin);
    } else if (value.startsWith("/object/")) {
      signedUrl = new URL(`/storage/v1${value}`, base.origin);
    } else {
      signedUrl = new URL(`/storage/v1/${value.replace(/^\/+/, "")}`, base.origin);
    }
  } catch {
    throw new SupabaseStorageError(502);
  }

  if (
    signedUrl.origin !== base.origin ||
    !signedUrl.pathname.startsWith("/storage/v1/object/sign/")
  ) {
    throw new SupabaseStorageError(502);
  }
  return signedUrl.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
