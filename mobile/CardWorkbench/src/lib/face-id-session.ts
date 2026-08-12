import * as SecureStore from 'expo-secure-store';

export const FACE_ID_SESSION_DURATION_MS = 60 * 60 * 1000;

const SESSION_KEY = 'privacy.face-id-session.v1';
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
const SECURE_STORE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;

type StoredFaceIdSession = {
  issuedAt: number;
  expiresAt: number;
};

type SessionListener = () => void;

const revokeListeners = new Set<SessionListener>();

export async function loadValidFaceIdSession(now = Date.now()): Promise<number | null> {
  const stored = await SecureStore.getItemAsync(SESSION_KEY);
  if (!stored) return null;

  let session: StoredFaceIdSession;
  try {
    session = JSON.parse(stored) as StoredFaceIdSession;
  } catch {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  }

  const validShape =
    Number.isFinite(session.issuedAt) &&
    Number.isFinite(session.expiresAt) &&
    session.expiresAt - session.issuedAt === FACE_ID_SESSION_DURATION_MS;
  const validClock =
    session.issuedAt <= now + CLOCK_SKEW_TOLERANCE_MS &&
    session.expiresAt > now &&
    session.expiresAt <= now + FACE_ID_SESSION_DURATION_MS + CLOCK_SKEW_TOLERANCE_MS;

  if (!validShape || !validClock) {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  }
  return session.expiresAt;
}

export async function createFaceIdSession(now = Date.now()): Promise<number> {
  const expiresAt = now + FACE_ID_SESSION_DURATION_MS;
  const session: StoredFaceIdSession = { issuedAt: now, expiresAt };
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), SECURE_STORE_OPTIONS);
  return expiresAt;
}

export async function revokeFaceIdSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
  for (const listener of revokeListeners) listener();
}

export function subscribeToFaceIdSessionRevocation(listener: SessionListener): () => void {
  revokeListeners.add(listener);
  return () => revokeListeners.delete(listener);
}
