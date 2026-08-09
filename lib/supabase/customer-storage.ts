import type { SearchBackendConfig } from "@/lib/supabase/rest";
import { SupabaseRestError } from "@/lib/supabase/rest";

const REQUEST_TIMEOUT_MS = 20_000;

type SupabaseConfig = Extract<SearchBackendConfig, { mode: "supabase" }>;

export async function uploadCustomerIdentityImage(
  config: SupabaseConfig,
  userAccessToken: string,
  bucket: string,
  objectPath: string,
  file: File,
): Promise<void> {
  const response = await storageRequest(
    config,
    userAccessToken,
    bucket,
    objectPath,
    {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "x-upsert": "false",
      },
      body: file,
    },
  );
  await response.body?.cancel();
}

export async function deleteCustomerIdentityImage(
  config: SupabaseConfig,
  userAccessToken: string,
  bucket: string,
  objectPath: string,
): Promise<void> {
  const response = await storageRequest(
    config,
    userAccessToken,
    bucket,
    objectPath,
    { method: "DELETE" },
  );
  await response.body?.cancel();
}

async function storageRequest(
  config: SupabaseConfig,
  userAccessToken: string,
  bucket: string,
  objectPath: string,
  init: Pick<RequestInit, "method" | "headers" | "body">,
): Promise<Response> {
  const encodedPath = objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
      {
        ...init,
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${userAccessToken}`,
          ...init.headers,
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new SupabaseRestError(response.status);
    }
    return response;
  } catch (error) {
    if (error instanceof SupabaseRestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SupabaseRestError(504);
    }
    throw new SupabaseRestError(502);
  } finally {
    clearTimeout(timeout);
  }
}
