import CredentialVault from '@credential-vault';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getCredentials } from './credential-vault';
import { localDueToRemote } from './date';
import { syncFingerprint, syncRecordKey, validateSyncDocument, type SyncBaseline, type SyncCategory, type SyncCredential, type SyncDocument, type SyncRecord, type SyncTask } from './account-sync-model';

type CategoryRow = { id: string; name: string; color: string; tint: string; icon: string; sort_order: number };
type TaskRow = {
  id: number; remote_id: string | null; notes: string | null; label: string | null;
  category_id: string; is_starred: number; due_at: string | null; repeat_rule: SyncTask['repeatRule'];
  recurrence_anchor_due_at: string | null; recurrence_parent_id: number | null; metadata_initialized: number;
  metadata_core_due_at: string | null;
  metadata_raw_due_at: string | null;
};
export type AccountSyncSnapshot = { revision: number; document: SyncDocument; taskRows: TaskRow[] };
export class LocalAccountSyncChanged extends Error {
  constructor() { super('同步期间本机资料有新改动，已保留，将重新合并。'); this.name = 'LocalAccountSyncChanged'; }
}

export async function getAccountSyncLocalRevision(database: SQLiteDatabase): Promise<number> {
  return (await database.getFirstAsync<{ revision: number }>('SELECT revision FROM account_sync_revision WHERE id = 1'))?.revision ?? 0;
}
export async function getAccountSyncBoundScope(database: SQLiteDatabase): Promise<string | null> {
  return (await database.getFirstAsync<{ value: string }>("SELECT value FROM app_metadata WHERE key = 'account-sync.bound-scope'"))?.value ?? null;
}
export async function getAccountSyncKnownRevision(database: SQLiteDatabase, scope: string): Promise<number> {
  const row = await database.getFirstAsync<{ value: string }>('SELECT value FROM app_metadata WHERE key = ?', `account-sync.revision.${scope}`);
  return row ? Number(row.value) : 0;
}
export async function loadAccountSyncBaselines(database: SQLiteDatabase, scope: string, guard: () => Promise<void> = async () => undefined): Promise<SyncBaseline[]> {
  const rows = await database.getAllAsync<SyncBaseline>('SELECT kind, id, local_hash, remote_hash FROM account_sync_baselines WHERE scope = ?', scope);
  const baselines: SyncBaseline[] = [];
  for (const row of rows) {
    await guard();
    if (row.remote_hash !== 'device-encrypted:v1' || !row.local_hash) throw new Error('同步基线格式不兼容，已停止以保护密码库。');
    const encrypted = JSON.parse(row.local_hash) as { ciphertext: string; keyVersion: number };
    const plaintext = await CredentialVault.decryptAsync(baselineRecordId(scope, row), encrypted.ciphertext, encrypted.keyVersion);
    await guard();
    const hashes = JSON.parse(plaintext) as Pick<SyncBaseline, 'local_hash' | 'remote_hash'>;
    if (![hashes.local_hash, hashes.remote_hash].every((hash) => hash === null || (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)))) throw new Error('同步基线内容无效，已停止。');
    baselines.push({ kind: row.kind, id: row.id, ...hashes });
  }
  return baselines;
}

const baselineRecordId = (scope: string, record: Pick<SyncRecord, 'kind' | 'id'>) => `account-sync-baseline:${scope}:${record.kind}:${record.id}`;
async function storeEncryptedBaseline(database: SQLiteDatabase, scope: string, record: SyncRecord, localHash: string | null, remoteHash: string | null, guard: () => Promise<void>): Promise<void> {
  // Even a fast fingerprint of a secret-bearing record can become an offline
  // password oracle. Store the pair only inside device-key AES-GCM ciphertext.
  await guard();
  const encrypted = await CredentialVault.encryptAsync(baselineRecordId(scope, record), JSON.stringify({ local_hash: localHash, remote_hash: remoteHash }));
  await guard();
  await database.runAsync(`INSERT INTO account_sync_baselines (scope, kind, id, local_hash, remote_hash)
    VALUES (?, ?, ?, ?, 'device-encrypted:v1') ON CONFLICT(scope, kind, id) DO UPDATE SET local_hash=excluded.local_hash, remote_hash=excluded.remote_hash`,
  scope, record.kind, record.id, JSON.stringify(encrypted));
}

export async function captureAccountSyncSnapshot(database: SQLiteDatabase, guard: () => Promise<void> = async () => undefined): Promise<AccountSyncSnapshot> {
  await guard();
  const revision = await getAccountSyncLocalRevision(database);
  const taskRows = await database.getAllAsync<TaskRow>('SELECT id, remote_id, notes, label, category_id, is_starred, due_at, repeat_rule, recurrence_anchor_due_at, recurrence_parent_id, metadata_initialized, metadata_core_due_at, metadata_raw_due_at FROM todo_items');
  const todoCategories = await database.getAllAsync<CategoryRow>('SELECT * FROM todo_categories');
  const credentialCategories = await database.getAllAsync<CategoryRow>('SELECT * FROM credential_categories');
  const credentials = await getCredentials(database, guard);
  const deletedCredentials = await database.getAllAsync<{ id: string }>('SELECT id FROM account_sync_deleted_credentials');
  if (await getAccountSyncLocalRevision(database) !== revision) throw new LocalAccountSyncChanged();
  await guard();
  const records: SyncRecord[] = [];
  for (const [kind, categories] of [['todo-category', todoCategories], ['credential-category', credentialCategories]] as const) {
    for (const category of categories) records.push({ kind, id: category.id, deleted: false, data: { name: category.name, color: category.color, tint: category.tint, icon: category.icon, sortOrder: category.sort_order } });
  }
  const tasksById = new Map(taskRows.map((task) => [task.id, task]));
  for (const task of taskRows) {
    if (!task.remote_id || !task.metadata_initialized) continue;
    records.push({ kind: 'task', id: task.remote_id, deleted: false, data: {
      notes: task.notes, label: task.label, categoryId: task.category_id, isStarred: task.is_starred === 1,
      dueAt: task.due_at, repeatRule: task.repeat_rule, recurrenceAnchorDueAt: task.recurrence_anchor_due_at,
      coreDueAt: task.metadata_raw_due_at === task.due_at ? task.metadata_core_due_at ?? localDueToRemote(task.due_at) : localDueToRemote(task.due_at),
      recurrenceParentRemoteId: task.recurrence_parent_id === null ? null : tasksById.get(task.recurrence_parent_id)?.remote_id ?? null,
    } });
  }
  for (const entry of credentials) records.push({ kind: 'credential', id: entry.id, deleted: false, data: {
    platformName: entry.platformName, categoryId: entry.categoryId, icon: entry.icon,
    createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    secret: { account: entry.account, password: entry.password, email: entry.email, nickname: entry.nickname, website: entry.website, notes: entry.notes, tags: entry.tags },
  } });
  const existingIds = new Set(credentials.map((entry) => entry.id));
  for (const entry of deletedCredentials) if (!existingIds.has(entry.id)) records.push({ kind: 'credential', id: entry.id, deleted: true, data: null });
  return { revision, document: validateSyncDocument({ version: 1, records }), taskRows };
}

async function rememberScope(database: SQLiteDatabase, scope: string, cloudRevision: number) {
  const bound = await getAccountSyncBoundScope(database);
  if (bound && bound !== scope) throw new Error('本机资料已绑定另一账号，为避免泄露已停止同步。请恢复原账号配对。');
  await database.runAsync("INSERT OR IGNORE INTO app_metadata (key, value) VALUES ('account-sync.bound-scope', ?)", scope);
  await database.runAsync('INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', `account-sync.revision.${scope}`, String(cloudRevision));
}

/** Persist only fingerprints after an acknowledged CAS; this is safe even if an in-flight edit makes the import stale. */
export async function rememberAccountSyncAcknowledgement(database: SQLiteDatabase, scope: string, cloudRevision: number, local: SyncDocument, merged: SyncDocument, guard: () => Promise<void> = async () => undefined): Promise<void> {
  const localMap = new Map(local.records.map((record) => [syncRecordKey(record), record]));
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync('PRAGMA busy_timeout = 5000;');
    await rememberScope(transaction, scope, cloudRevision);
    for (const record of merged.records) await storeEncryptedBaseline(transaction, scope, record, syncFingerprint(localMap.get(syncRecordKey(record))), syncFingerprint(record), guard);
  });
}

/** Re-encrypt imported credentials with this device's Keychain/Keystore key before touching SQLite. */
export async function applyAccountSyncDocument(database: SQLiteDatabase, scope: string, cloudRevision: number, snapshot: AccountSyncSnapshot, document: SyncDocument, guard: () => Promise<void> = async () => undefined): Promise<void> {
  const knownTasks = new Set(snapshot.taskRows.map((task) => task.remote_id).filter(Boolean));
  const childrenByParent = new Map<string, string[]>();
  for (const record of document.records) {
    if (record.kind !== 'task' || record.deleted || !knownTasks.has(record.id)) continue;
    const parent = (record.data as SyncTask).recurrenceParentRemoteId;
    if (!parent) continue;
    const children = childrenByParent.get(parent) ?? [];
    children.push(record.id);
    childrenByParent.set(parent, children);
    if (children.length > 1) throw new Error('同一个重复待办被两台手机生成了不同的下一期，已保留双方记录并停止导入。请先在网页工作台核对两条子待办，明确保留哪条后再重试；不会自动删除你编辑过的待办。');
  }
  const original = new Map(snapshot.document.records.map((record) => [syncRecordKey(record), record]));
  const encryptedEntries = new Map<string, { ciphertext: string; keyVersion: number }>();
  for (const record of document.records) {
    if (record.kind !== 'credential' || record.deleted || syncFingerprint(original.get(syncRecordKey(record))) === syncFingerprint(record)) continue;
    const entry = record.data as SyncCredential;
    await guard();
    encryptedEntries.set(record.id, await CredentialVault.encryptAsync(record.id, JSON.stringify(entry.secret)));
    await guard();
  }
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync('PRAGMA busy_timeout = 5000;');
    await transaction.runAsync('UPDATE account_sync_revision SET revision = revision WHERE id = 1');
    await guard();
    if (await getAccountSyncLocalRevision(transaction) !== snapshot.revision) throw new LocalAccountSyncChanged();
    await rememberScope(transaction, scope, cloudRevision);
    const actual = new Map(original);
    for (const record of document.records) {
      if (!record.kind.endsWith('category')) continue;
      if (syncFingerprint(actual.get(syncRecordKey(record))) === syncFingerprint(record)) continue;
      const category = record.data as SyncCategory;
      const table = record.kind === 'todo-category' ? 'todo_categories' : 'credential_categories';
      await transaction.runAsync(`INSERT INTO ${table} (id, name, color, tint, icon, sort_order)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, tint=excluded.tint, icon=excluded.icon, sort_order=excluded.sort_order`,
      record.id, category.name, category.color, category.tint, category.icon, category.sortOrder);
      actual.set(syncRecordKey(record), record);
    }
    const tasksByRemote = new Map(snapshot.taskRows.filter((task) => task.remote_id).map((task) => [task.remote_id!, task]));
    for (const record of document.records) {
      if (record.kind.endsWith('category')) continue;
      if (syncFingerprint(actual.get(syncRecordKey(record))) === syncFingerprint(record)) continue;
      if (record.kind === 'credential') {
        if (record.deleted) {
          await transaction.runAsync('DELETE FROM credential_entries WHERE id = ?', record.id);
          await transaction.runAsync('INSERT OR IGNORE INTO account_sync_deleted_credentials (id) VALUES (?)', record.id);
        } else {
          const entry = record.data as SyncCredential;
          const encrypted = encryptedEntries.get(record.id)!;
          await transaction.runAsync(`INSERT INTO credential_entries (id, platform_name, category_id, icon, encrypted_payload, key_version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET platform_name=excluded.platform_name, category_id=excluded.category_id, icon=excluded.icon,
            encrypted_payload=excluded.encrypted_payload, key_version=excluded.key_version, created_at=excluded.created_at, updated_at=excluded.updated_at`,
          record.id, entry.platformName, entry.categoryId, entry.icon, encrypted.ciphertext, encrypted.keyVersion, entry.createdAt, entry.updatedAt);
          await transaction.runAsync('DELETE FROM account_sync_deleted_credentials WHERE id = ?', record.id);
        }
        actual.set(syncRecordKey(record), record);
      } else {
        const local = tasksByRemote.get(record.id);
        // The regular task API is authoritative for existence/title/status.
        // Never resurrect an orphan task solely from encrypted metadata.
        if (!local || record.deleted) continue;
        const task = record.data as SyncTask;
        const currentCoreDue = local.metadata_raw_due_at === local.due_at ? local.metadata_core_due_at ?? localDueToRemote(local.due_at) : localDueToRemote(local.due_at);
        const sameDueInstant = (task.coreDueAt ?? localDueToRemote(task.dueAt)) === currentCoreDue;
        const dueAt = sameDueInstant ? task.dueAt : local.due_at;
        const repeatRule = dueAt ? task.repeatRule : 'none';
        const anchor = repeatRule === 'none' ? null : sameDueInstant ? task.recurrenceAnchorDueAt : dueAt;
        const parentId = task.recurrenceParentRemoteId ? tasksByRemote.get(task.recurrenceParentRemoteId)?.id ?? null : null;
        await transaction.runAsync(`UPDATE todo_items SET notes=?, label=?, category_id=?, is_starred=?, due_at=?, repeat_rule=?, recurrence_anchor_due_at=?, recurrence_parent_id=?, metadata_initialized=1, metadata_core_due_at=?, metadata_raw_due_at=? WHERE remote_id=?`,
        task.notes, task.label, task.categoryId, task.isStarred ? 1 : 0, dueAt, repeatRule, anchor, parentId, currentCoreDue, dueAt, record.id);
        actual.set(syncRecordKey(record), { ...record, data: { ...task, dueAt, repeatRule, recurrenceAnchorDueAt: anchor, coreDueAt: currentCoreDue } });
      }
    }
    for (const record of document.records) await storeEncryptedBaseline(transaction, scope, record, syncFingerprint(actual.get(syncRecordKey(record))), syncFingerprint(record), guard);
    await guard();
    await transaction.runAsync("INSERT INTO app_metadata (key, value) VALUES ('account-sync.last-success', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", new Date().toISOString());
  });
}
