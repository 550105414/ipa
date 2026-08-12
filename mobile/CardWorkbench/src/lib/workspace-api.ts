import * as SecureStore from 'expo-secure-store';

import { normalizePinnedWorkspaceBaseUrl } from '@/config/workspace';
import { revokeFaceIdSession } from '@/lib/face-id-session';

const BASE_URL_KEY = 'workspace.base-url';
const DISPATCH_TOKEN_KEY = 'workspace.dispatch-token';
const DEVICE_TOKEN_KEY = 'workspace.device-token';
const SECURE_STORE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;

export type WorkspaceSession = {
  baseUrl: string;
  dispatchToken: string;
  deviceToken: string;
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class WorkspaceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = 'REQUEST_FAILED',
  ) {
    super(message);
    this.name = 'WorkspaceApiError';
  }
}

export async function loadWorkspaceSession(): Promise<WorkspaceSession | null> {
  const [baseUrl, dispatchToken, deviceToken] = await Promise.all([
    SecureStore.getItemAsync(BASE_URL_KEY),
    SecureStore.getItemAsync(DISPATCH_TOKEN_KEY),
    SecureStore.getItemAsync(DEVICE_TOKEN_KEY),
  ]);
  if (!baseUrl || !dispatchToken || !deviceToken) return null;
  try {
    return {
      baseUrl: normalizePinnedWorkspaceBaseUrl(baseUrl),
      dispatchToken,
      deviceToken,
    };
  } catch {
    // Never make authenticated requests to a legacy or tampered origin.
    return null;
  }
}

export async function clearWorkspaceSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(BASE_URL_KEY),
    SecureStore.deleteItemAsync(DISPATCH_TOKEN_KEY),
    SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY),
    revokeFaceIdSession(),
  ]);
}

export async function hasStoredWorkspaceCredentials(): Promise<boolean> {
  const values = await Promise.all([
    SecureStore.getItemAsync(BASE_URL_KEY),
    SecureStore.getItemAsync(DISPATCH_TOKEN_KEY),
    SecureStore.getItemAsync(DEVICE_TOKEN_KEY),
  ]);
  return values.some(Boolean);
}

export async function exchangePairing(input: {
  baseUrl: string;
  code: string;
  dispatchToken: string;
}): Promise<WorkspaceSession> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const dispatchToken = input.dispatchToken.trim();
  const code = input.code.trim();
  if (!dispatchToken || !code) {
    throw new WorkspaceApiError('配对链接缺少必要信息，请在电脑端重新生成。', 400, 'PAIRING_LINK_INVALID');
  }

  const response = await fetch(new URL('/api/device-pairings/exchange', baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'OAI-Sites-Authorization': `Bearer ${dispatchToken}`,
    },
    body: JSON.stringify({ code }),
  });
  const body = await readJson<Record<string, unknown>>(response);
  if (!response.ok) throw apiError(response, body);
  const deviceToken = typeof body.deviceToken === 'string' ? body.deviceToken.trim() : '';
  if (!deviceToken) {
    throw new WorkspaceApiError('配对服务未返回设备凭证，请重新生成配对链接。', 502, 'PAIRING_RESPONSE_INVALID');
  }

  await Promise.all([
    SecureStore.setItemAsync(BASE_URL_KEY, baseUrl, SECURE_STORE_OPTIONS),
    SecureStore.setItemAsync(DISPATCH_TOKEN_KEY, dispatchToken, SECURE_STORE_OPTIONS),
    SecureStore.setItemAsync(DEVICE_TOKEN_KEY, deviceToken, SECURE_STORE_OPTIONS),
  ]);
  return { baseUrl, dispatchToken, deviceToken };
}

export async function workspaceRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const session = await requireWorkspaceSession();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('OAI-Sites-Authorization', `Bearer ${session.dispatchToken}`);
  headers.set('X-Workspace-Device-Token', session.deviceToken);
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(workspaceUrl(path, session.baseUrl), { ...init, headers });
  } catch {
    throw new WorkspaceApiError('网络连接失败，请检查网络后重试。', 0, 'NETWORK_ERROR');
  }
  if (!response.ok) {
    const body = await readJson<ApiErrorBody>(response.clone());
    throw apiError(response, body);
  }
  return response;
}

export async function workspaceJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await workspaceRequest(path, init);
  return readJson<T>(response);
}

export async function workspaceImageSource(path: string | null): Promise<
  | {
      uri: string;
      headers: Record<string, string>;
    }
  | undefined
> {
  if (!path) return undefined;
  const session = await requireWorkspaceSession();
  return {
    uri: workspaceUrl(path, session.baseUrl).toString(),
    headers: workspaceAuthHeaders(session),
  };
}

export function workspaceAuthHeaders(session: WorkspaceSession): Record<string, string> {
  return {
    'OAI-Sites-Authorization': `Bearer ${session.dispatchToken}`,
    'X-Workspace-Device-Token': session.deviceToken,
  };
}

async function requireWorkspaceSession(): Promise<WorkspaceSession> {
  const session = await loadWorkspaceSession();
  if (!session) {
    throw new WorkspaceApiError('这台 iPhone 尚未与工作台配对。', 401, 'DEVICE_PAIRING_REQUIRED');
  }
  return session;
}

function workspaceUrl(path: string, baseUrl: string): URL {
  try {
    const url = new URL(path, baseUrl);
    normalizePinnedWorkspaceBaseUrl(url.toString());
    return url;
  } catch {
    throw new WorkspaceApiError(
      '请求地址不受信任，请重新连接工作台。',
      400,
      'WORKSPACE_URL_INVALID',
    );
  }
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(normalizePinnedWorkspaceBaseUrl(value));
  } catch {
    throw new WorkspaceApiError('配对地址无效，请重新生成配对链接。', 400, 'PAIRING_BASE_URL_INVALID');
  }
  if (url.protocol !== 'https:') {
    throw new WorkspaceApiError('配对地址无效，请重新生成配对链接。', 400, 'PAIRING_BASE_URL_INVALID');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    if (!response.ok) {
      throw new WorkspaceApiError(`服务器请求失败（${response.status}）`, response.status);
    }
    throw new WorkspaceApiError('服务器返回了无法识别的数据。', response.status, 'INVALID_RESPONSE');
  }
}

function apiError(response: Response, body: unknown): WorkspaceApiError {
  const candidate = body as ApiErrorBody;
  return new WorkspaceApiError(
    candidate?.error?.message || `服务器请求失败（${response.status}）`,
    response.status,
    candidate?.error?.code || 'REQUEST_FAILED',
  );
}
