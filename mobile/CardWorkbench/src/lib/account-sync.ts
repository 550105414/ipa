import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { SQLiteDatabase } from 'expo-sqlite';
import { AppState } from 'react-native';

import { decryptSyncDocument, encryptSyncDocument, validateSyncEnvelope, validateSyncPassword, type SyncEnvelope } from './account-sync-crypto';
import { AccountSyncConflict, canonicalJson, mergeSyncDocuments, type SyncDocument, type SyncResolution } from './account-sync-model';
import { applyAccountSyncDocument, captureAccountSyncSnapshot, getAccountSyncBoundScope, getAccountSyncKnownRevision, loadAccountSyncBaselines, LocalAccountSyncChanged, rememberAccountSyncAcknowledgement } from './account-sync-storage';
import { emitAccountSyncChange } from './account-sync-events';
import { loadValidFaceIdSession } from './face-id-session';
import { syncWorkspaceTasks } from './task-sync';
import { loadWorkspaceSession, workspaceAuthHeaders, WorkspaceApiError, type WorkspaceSession } from './workspace-api';

type PasswordState = { current: string; pending?: string };
type CloudState = { scope: string; revision: number; envelope: SyncEnvelope | null; updatedAt: string | null };
export type AccountSyncStatus = {
  phase: 'disabled' | 'unpaired' | 'paused' | 'syncing' | 'ready' | 'error' | 'conflict';
  scope: string | null; configured: boolean; lastSyncedAt: string | null;
  message: string; conflictCount: number;
};
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;
const passwordKey = (scope: string) => `account-sync.password.${scope}`;
const passwordEpochs = new Map<string, number>();
const passwordWrites = new Map<string, Promise<unknown>>();
let passwordIntentEpoch = 0;
let passwordSettingsInProgress = 0;
class PasswordSyncCancelled extends Error {
  constructor() { super('同步密码设置已变化，旧同步已停止；未恢复已移除的密码。'); }
}
let status: AccountSyncStatus = { phase: 'disabled', scope: null, configured: false, lastSyncedAt: null, message: '尚未设置跨设备同步密码；本机资料不受影响。', conflictCount: 0 };
const statusListeners = new Set<() => void>();
export const getAccountSyncStatus = () => status;
export const subscribeAccountSyncStatus = (listener: () => void) => { statusListeners.add(listener); return () => { statusListeners.delete(listener); }; };
const updateStatus = (next: Partial<AccountSyncStatus>) => { status = { ...status, ...next }; for (const listener of statusListeners) listener(); };

async function requireUnlocked(): Promise<void> {
  if (AppState.currentState !== 'active' || !(await loadValidFaceIdSession())) throw new Error('请在解锁后的工作台中同步；后台和锁定期间不会自动读取密码库。');
}
async function guardSession(original: WorkspaceSession): Promise<void> {
  await requireUnlocked();
  const current = await loadWorkspaceSession();
  if (!current || current.deviceToken !== original.deviceToken || current.baseUrl !== original.baseUrl || current.dispatchToken !== original.dispatchToken) throw new Error('连接凭证已变化，已停止同步，请重新检查账号。');
}
async function boundedRequest<T>(session: WorkspaceSession, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const active = AppState.addEventListener('change', (state) => { if (state !== 'active') controller.abort(); });
  try {
    // Bind URL and both auth headers to the session captured at the start of
    // this operation. Reloading credentials here creates a cross-account TOCTOU.
    const response = await fetch(new URL('/api/mobile-sync', session.baseUrl), {
      ...init,
      signal: controller.signal,
      headers: { ...workspaceAuthHeaders(session), Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403 ? '设备配对已失效，请重新连接同一账号。'
        : response.status === 404 ? '服务器尚未提供加密同步服务，请先升级服务端。'
          : response.status === 409 ? '云端已有新版本，正在重新合并。'
            : response.status === 413 ? '加密同步资料超过云端容量，本机资料已保留。'
              : `同步请求失败（${response.status}），本机资料已保留。`;
      throw new WorkspaceApiError(message, response.status);
    }
    try { return await response.json() as T; }
    catch { throw new Error('服务器同步响应无法解析，未按空库处理。'); }
  } catch (error) {
    if (error instanceof WorkspaceApiError || (error instanceof Error && error.message.includes('同步响应'))) throw error;
    throw new WorkspaceApiError('网络中断或同步已取消，本机数据已保留，请在解锁后重试。', 0, 'NETWORK_ERROR');
  }
  finally { clearTimeout(timeout); active.remove(); }
}
async function readCloud(database: SQLiteDatabase, session: WorkspaceSession): Promise<CloudState> {
  const cloud = await boundedRequest<CloudState>(session);
  if (!cloud || typeof cloud.scope !== 'string' || !/^[a-f0-9]{64}$/.test(cloud.scope) || !Number.isSafeInteger(cloud.revision) || cloud.revision < 0 || !(cloud.updatedAt === null || typeof cloud.updatedAt === 'string')) throw new Error('服务器同步响应无效，未按空数据库处理。');
  if (cloud.envelope === null) {
    if (cloud.revision !== 0 || cloud.updatedAt !== null) throw new Error('云端同步库状态不一致，已停止。');
  } else {
    validateSyncEnvelope(cloud.envelope);
    if (cloud.revision === 0) throw new Error('云端同步版本无效，已停止。');
  }
  const bound = await getAccountSyncBoundScope(database);
  if (bound && bound !== cloud.scope) throw new Error('本机资料属于另一账号，已停止同步以保护密码库。请恢复原账号配对。');
  const knownRevision = await getAccountSyncKnownRevision(database, cloud.scope);
  if (cloud.revision < knownRevision) throw new Error('云端同步库版本回退或已缺失，已停止，未重建或覆盖云端。');
  return cloud;
}
async function readPasswords(scope: string): Promise<PasswordState | null> {
  const value = await SecureStore.getItemAsync(passwordKey(scope));
  if (!value) return null;
  const parsed = JSON.parse(value) as PasswordState;
  validateSyncPassword(parsed.current);
  if (parsed.pending !== undefined) validateSyncPassword(parsed.pending);
  return parsed;
}
function writePasswords(scope: string, passwords: PasswordState | null, guard: () => Promise<void>, expectedEpoch?: number): Promise<number> {
  if (expectedEpoch !== undefined && (passwordEpochs.get(scope) ?? 0) !== expectedEpoch) return Promise.reject(new PasswordSyncCancelled());
  // Reserve synchronously, before any await, and serialize Keychain writes so
  // an earlier in-flight promotion cannot finish after a later deletion.
  const epoch = (passwordEpochs.get(scope) ?? 0) + 1;
  passwordEpochs.set(scope, epoch);
  const previous = passwordWrites.get(scope) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(async () => {
    await guard();
    if ((passwordEpochs.get(scope) ?? 0) !== epoch) throw new PasswordSyncCancelled();
    if (passwords) await SecureStore.setItemAsync(passwordKey(scope), JSON.stringify(passwords), secureOptions);
    else await SecureStore.deleteItemAsync(passwordKey(scope));
    await guard();
    if ((passwordEpochs.get(scope) ?? 0) !== epoch) throw new PasswordSyncCancelled();
    return epoch;
  });
  passwordWrites.set(scope, pending);
  return pending;
}

async function openCloud(cloud: CloudState, passwords: PasswordState, guard: () => Promise<void>): Promise<{ document: SyncDocument; passwords: PasswordState; promote?: boolean }> {
  await guard();
  if (!cloud.envelope) return { document: { version: 1, records: [] }, passwords };
  if (passwords.pending) {
    try {
      const document = await decryptSyncDocument(passwords.pending, cloud.scope, cloud.envelope);
      await guard();
      // Do not write SecureStore here: a user may remove the password while
      // PBKDF2 is running. Promotion happens after the guarded sync commits.
      return { document, passwords: { current: passwords.pending }, promote: true };
    } catch {
      // A staged rotation may not have reached the server. Try the committed
      // password, but never replace the cloud if neither can authenticate it.
    }
  }
  await guard();
  const document = await decryptSyncDocument(passwords.current, cloud.scope, cloud.envelope);
  await guard();
  return { document, passwords };
}

type SyncOptions = { skipCore?: boolean; resolution?: SyncResolution };
type Worker = { running: Promise<void> | null; requested: number; options: SyncOptions };
const workers = new WeakMap<SQLiteDatabase, Worker>();

/** Serial latest-wins entry point; no automatic POST/PUT retry after an ambiguous network failure. */
export function syncAccountData(database: SQLiteDatabase, options: SyncOptions = {}): Promise<void> {
  let worker = workers.get(database);
  if (!worker) { worker = { running: null, requested: 0, options }; workers.set(database, worker); }
  worker.options = options;
  worker.requested += 1;
  if (!worker.running) {
    const currentWorker = worker;
    currentWorker.running = (async () => {
      try {
        let completed = 0;
        while (completed !== currentWorker.requested) {
          const requested = currentWorker.requested;
          try { await performSync(database, currentWorker.options); }
          catch (error) {
            if (!(error instanceof PasswordSyncCancelled)) updateStatus({ phase: error instanceof AccountSyncConflict ? 'conflict' : 'error', message: error instanceof Error ? error.message : '加密同步失败，本机数据已保留。', conflictCount: error instanceof AccountSyncConflict ? error.recordKeys.length : 0 });
            if (requested === currentWorker.requested) throw error;
          }
          completed = requested;
        }
      } finally { currentWorker.running = null; }
    })();
  }
  return worker.running!;
}

async function performSync(database: SQLiteDatabase, options: SyncOptions): Promise<void> {
  if (passwordSettingsInProgress) return;
  const intentEpoch = passwordIntentEpoch;
  const session = await loadWorkspaceSession();
  if (!session) { updateStatus({ phase: 'unpaired', configured: false, scope: null, conflictCount: 0, message: '两台手机须分别配对到同一个工作台账号，设备登录凭证不会跨手机复制。' }); return; }
  if (AppState.currentState !== 'active' || !(await loadValidFaceIdSession())) {
    updateStatus({ phase: 'paused', message: '已暂停：请解锁工作台后同步。' }); return;
  }
  if (!options.skipCore) await syncWorkspaceTasks(database);
  await guardSession(session);
  let resolution = options.resolution ?? 'block';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const cloud = await readCloud(database, session);
      await guardSession(session);
      const passwordEpoch = passwordEpochs.get(cloud.scope) ?? 0;
      const guardIdentity = async () => {
        await guardSession(session);
        if (passwordIntentEpoch !== intentEpoch) throw new PasswordSyncCancelled();
      };
      const guard = async () => {
        await guardIdentity();
        if ((passwordEpochs.get(cloud.scope) ?? 0) !== passwordEpoch) throw new PasswordSyncCancelled();
      };
      await guard();
      const passwords = await readPasswords(cloud.scope);
      await guard();
      updateStatus({ scope: cloud.scope, configured: Boolean(passwords) });
      if (!passwords) { updateStatus({ phase: 'disabled', conflictCount: 0, message: '基础客户和待办可正常使用；设置相同同步密码后互通密码库、备注、分类和重复规则。' }); return; }
      updateStatus({ phase: 'syncing', conflictCount: 0, message: '正在解密、合并并同步资料…' });
      const opened = await openCloud(cloud, passwords, guard);
      await guard();
      const snapshot = await captureAccountSyncSnapshot(database, guard);
      const baselines = await loadAccountSyncBaselines(database, cloud.scope, guard);
      await guard();
      const merged = mergeSyncDocuments(snapshot.document, opened.document, baselines, resolution);
      let cloudRevision = cloud.revision;
      if (!cloud.envelope || opened.passwords.pending || canonicalJson(merged) !== canonicalJson(opened.document)) {
        const writePassword = opened.passwords.pending ?? opened.passwords.current;
        const envelope = await encryptSyncDocument(writePassword, cloud.scope, merged, Crypto.getRandomBytesAsync,
          opened.passwords.pending ? undefined : cloud.envelope?.salt);
        await guard();
        const result = await boundedRequest<{ revision: number; updatedAt: string }>(session, { method: 'PUT', body: JSON.stringify({ expectedRevision: cloud.revision, envelope }) });
        if (!result || result.revision !== cloud.revision + 1 || typeof result.updatedAt !== 'string') throw new Error('服务器未确认同步版本，已保留本机资料，请重新检查。');
        cloudRevision = result.revision;
      }
      await guardSession(session);
      await rememberAccountSyncAcknowledgement(database, cloud.scope, cloudRevision, snapshot.document, merged, guard);
      await applyAccountSyncDocument(database, cloud.scope, cloudRevision, snapshot, merged, guard);
      if (opened.promote || opened.passwords.pending) {
        await guard();
        const committedEpoch = await writePasswords(cloud.scope, { current: opened.passwords.pending ?? opened.passwords.current }, guardIdentity, passwordEpoch);
        await guardIdentity();
        if ((passwordEpochs.get(cloud.scope) ?? 0) !== committedEpoch) throw new PasswordSyncCancelled();
      }
      updateStatus({ phase: 'ready', configured: true, lastSyncedAt: new Date().toISOString(), message: '加密同步完成：密码库和完整待办字段已合并；客户资料使用同一工作台账号。', conflictCount: 0 });
      emitAccountSyncChange('imported');
      return;
    } catch (error) {
      if (error instanceof LocalAccountSyncChanged || (error && typeof error === 'object' && 'status' in error && error.status === 409)) {
        // A new concurrent cloud edit needs a fresh user decision, not reuse of
        // an earlier destructive conflict preference against a different revision.
        resolution = 'block';
        if (attempt < 2) continue;
        throw new Error('其他设备或本机正在修改资料，已停止覆盖；稍后点击同步重试。');
      }
      throw error;
    }
  }
}

/** Validate against the cloud before saving a new/recovered password; a wrong password never resets the vault. */
export async function configureAccountSyncPassword(database: SQLiteDatabase, password: string): Promise<void> {
  const intent = ++passwordIntentEpoch;
  passwordSettingsInProgress = intent;
  try {
    validateSyncPassword(password);
    await requireUnlocked();
    const session = await loadWorkspaceSession();
    if (!session) throw new Error('请先将这台手机配对到同一工作台账号。');
    const guard = async () => { await guardSession(session); if (passwordIntentEpoch !== intent) throw new PasswordSyncCancelled(); };
    const cloud = await readCloud(database, session);
    await guard();
    if (cloud.envelope) await decryptSyncDocument(password, cloud.scope, cloud.envelope);
    await guard();
    await writePasswords(cloud.scope, { current: password }, guard);
    updateStatus({ configured: true, scope: cloud.scope });
  } finally { if (passwordSettingsInProgress === intent) passwordSettingsInProgress = 0; }
  emitAccountSyncChange('settings-changed');
  await syncAccountData(database);
}

/** Two-phase rotation retains both committed and staged passwords until the server proves which one is active. */
export async function changeAccountSyncPassword(database: SQLiteDatabase, password: string): Promise<void> {
  const intent = ++passwordIntentEpoch;
  passwordSettingsInProgress = intent;
  try {
    validateSyncPassword(password);
    await requireUnlocked();
    const session = await loadWorkspaceSession();
    if (!session) throw new Error('请先将这台手机配对到同一工作台账号。');
    const guard = async () => { await guardSession(session); if (passwordIntentEpoch !== intent) throw new PasswordSyncCancelled(); };
    const cloud = await readCloud(database, session);
    await guard();
    const passwords = await readPasswords(cloud.scope);
    if (!passwords) throw new Error('请先用当前同步密码连接，再修改密码。');
    const opened = await openCloud(cloud, passwords, guard);
    await guard();
    await writePasswords(cloud.scope, { current: opened.passwords.current, pending: password }, guard);
  } finally { if (passwordSettingsInProgress === intent) passwordSettingsInProgress = 0; }
  emitAccountSyncChange('settings-changed');
  await syncAccountData(database);
}

export async function forgetAccountSyncPassword(): Promise<void> {
  const intent = ++passwordIntentEpoch;
  passwordSettingsInProgress = intent;
  const scope = status.scope;
  try {
    const guard = async () => { await requireUnlocked(); if (passwordIntentEpoch !== intent) throw new PasswordSyncCancelled(); };
    if (scope) await writePasswords(scope, null, guard);
    else await guard();
    updateStatus({ configured: false, phase: 'disabled', conflictCount: 0, message: '已移除本机同步密码；本机资料、云端密文均未删除。' });
  } finally { if (passwordSettingsInProgress === intent) passwordSettingsInProgress = 0; }
}
