type ApiErrorShape = {
  error?: string | { code?: string; message?: string };
};

export function customerRequestHeaders(json = false): Headers {
  const headers = new Headers();
  if (json) headers.set("Content-Type", "application/json");

  const token = getStoredAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export function apiErrorMessage(
  payload: unknown,
  fallback: string,
): string {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as ApiErrorShape).error;
  if (typeof error === "string" && error.trim()) return error;
  if (
    error &&
    typeof error === "object" &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return fallback;
}

function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const directToken = window.localStorage.getItem(
      "sales-workbench-access-token",
    );
    if (directToken) return directToken;

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;

      try {
        const value = JSON.parse(window.localStorage.getItem(key) ?? "null") as
          | {
              access_token?: unknown;
              currentSession?: { access_token?: unknown };
            }
          | null;
        const token =
          value?.access_token ?? value?.currentSession?.access_token ?? null;
        if (typeof token === "string" && token.length > 0) return token;
      } catch {
        // Ignore malformed storage values that do not belong to this session.
      }
    }
  } catch {
    // Storage may be unavailable in hardened or private browser contexts.
  }

  return null;
}
