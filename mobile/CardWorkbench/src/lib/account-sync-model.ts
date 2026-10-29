import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export type SyncKind = 'task' | 'credential' | 'todo-category' | 'credential-category';
export type SyncCategory = { name: string; color: string; tint: string; icon: string; sortOrder: number };
export type SyncTask = {
  notes: string | null; label: string | null; categoryId: string; isStarred: boolean;
  dueAt: string | null; repeatRule: 'none' | 'daily' | 'weekly' | 'monthly';
  coreDueAt?: string | null;
  recurrenceAnchorDueAt: string | null; recurrenceParentRemoteId: string | null;
};
export type SyncCredential = {
  platformName: string; categoryId: string; icon: string; createdAt: string; updatedAt: string;
  secret: { account: string; password: string; email: string; nickname: string; website: string; notes: string; tags: string[] };
};
export type SyncRecord = {
  kind: SyncKind; id: string; deleted: boolean; data: SyncCategory | SyncTask | SyncCredential | null;
};
export type SyncDocument = { version: 1; records: SyncRecord[] };
export type SyncBaseline = { kind: SyncKind; id: string; local_hash: string | null; remote_hash: string | null };
export type SyncResolution = 'block' | 'local' | 'remote';

export class AccountSyncConflict extends Error {
  constructor(readonly recordKeys: string[]) {
    super(`有 ${recordKeys.length} 项记录在两台手机上都被修改，已停止同步，未覆盖任何一方。请在同步设置中明确选择冲突版本。`);
    this.name = 'AccountSyncConflict';
  }
}

export const syncRecordKey = (record: Pick<SyncRecord, 'kind' | 'id'>) => `${record.kind}:${record.id}`;
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export const syncFingerprint = (record: SyncRecord | undefined): string | null => record
  ? bytesToHex(sha256(utf8ToBytes(canonicalJson(record)))) : null;

/** Transient semantic identity for an unlocked conflict prompt; never persist it. */
export const syncDocumentFingerprint = (document: SyncDocument): string => bytesToHex(sha256(utf8ToBytes(canonicalJson({
  version: document.version,
  records: [...document.records].sort((a, b) => syncRecordKey(a).localeCompare(syncRecordKey(b))),
}))));

/** Separate local/remote baselines recover safely from an acknowledged upload followed by an interrupted import. */
export function mergeSyncDocuments(local: SyncDocument, remote: SyncDocument, baselines: SyncBaseline[], resolution: SyncResolution = 'block'): SyncDocument {
  const localMap = new Map(local.records.map((record) => [syncRecordKey(record), record]));
  const remoteMap = new Map(remote.records.map((record) => [syncRecordKey(record), record]));
  const baseMap = new Map(baselines.map((record) => [syncRecordKey(record), record]));
  const keys = [...new Set([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()])].sort();
  const records: SyncRecord[] = [];
  const conflicts: string[] = [];
  for (const key of keys) {
    const base = baseMap.get(key);
    let ours = localMap.get(key);
    const theirs = remoteMap.get(key);
    if (!ours && base?.local_hash) {
      ours = { kind: base.kind, id: base.id, deleted: true, data: null };
    }
    // Records are never removed from a cloud document: deletion has an explicit
    // tombstone. A missing previously-seen record is not an empty replacement.
    if (!theirs && base?.remote_hash) throw new Error('云端同步库缺少先前记录，已停止，未用空数据覆盖。');
    const ourHash = syncFingerprint(ours);
    const theirHash = syncFingerprint(theirs);
    const oursChanged = ourHash !== (base?.local_hash ?? null);
    const theirsChanged = theirHash !== (base?.remote_hash ?? null);
    let chosen: SyncRecord | undefined;
    if (ourHash === theirHash) chosen = theirs ?? ours;
    else if (!oursChanged) chosen = theirs;
    else if (!theirsChanged) chosen = ours;
    else if (resolution === 'local') chosen = ours;
    else if (resolution === 'remote') chosen = theirs;
    else { conflicts.push(key); continue; }
    if (chosen) records.push(chosen);
  }
  if (conflicts.length) throw new AccountSyncConflict(conflicts);
  return { version: 1, records };
}

function text(value: unknown, maximum = 100_000): value is string { return typeof value === 'string' && value.length <= maximum; }
function nullableText(value: unknown): boolean { return value === null || text(value); }
function validId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value); }

/** Treat authenticated but incompatible/corrupted JSON as an error, never as an empty vault. */
export function validateSyncDocument(value: unknown): SyncDocument {
  if (!value || typeof value !== 'object' || (value as SyncDocument).version !== 1 || !Array.isArray((value as SyncDocument).records)) throw new Error('同步数据格式不兼容，已停止导入。');
  const document = value as SyncDocument;
  if (document.records.length > 30_000) throw new Error('同步记录过多，已停止导入。');
  const seen = new Set<string>();
  for (const record of document.records) {
    if (!record || !['task', 'credential', 'todo-category', 'credential-category'].includes(record.kind) || !validId(record.id) || typeof record.deleted !== 'boolean') throw new Error('同步记录标识无效。');
    const key = syncRecordKey(record);
    if (seen.has(key)) throw new Error('同步记录标识重复，已停止导入。');
    seen.add(key);
    if (record.deleted) {
      if (record.data !== null || record.kind.endsWith('category')) throw new Error('同步删除记录无效。');
      continue;
    }
    const data = record.data;
    if (!data || typeof data !== 'object') throw new Error('同步记录内容缺失。');
    if (record.kind === 'task') {
      const task = data as SyncTask;
      if (!nullableText(task.notes) || !nullableText(task.label) || !validId(task.categoryId) || typeof task.isStarred !== 'boolean' || !nullableText(task.dueAt) || !(task.coreDueAt === undefined || nullableText(task.coreDueAt)) || !nullableText(task.recurrenceAnchorDueAt) || !(task.recurrenceParentRemoteId === null || validId(task.recurrenceParentRemoteId)) || !['none', 'daily', 'weekly', 'monthly'].includes(task.repeatRule)) throw new Error('待办同步字段无效。');
    } else if (record.kind === 'credential') {
      const entry = data as SyncCredential;
      const secret = entry.secret;
      if (!text(entry.platformName, 1000) || !validId(entry.categoryId) || !text(entry.icon, 200) || !text(entry.createdAt, 100) || !text(entry.updatedAt, 100) || !secret || !['account', 'password', 'email', 'nickname', 'website', 'notes'].every((key) => text(secret[key as keyof typeof secret])) || !Array.isArray(secret.tags) || secret.tags.length > 100 || !secret.tags.every((tag) => text(tag, 1000))) throw new Error('密码库同步字段无效。');
    } else {
      const category = data as SyncCategory;
      if (!text(category.name, 1000) || !text(category.color, 100) || !text(category.tint, 100) || !text(category.icon, 200) || !Number.isSafeInteger(category.sortOrder)) throw new Error('分类同步字段无效。');
    }
  }
  return { version: 1, records: [...document.records].sort((a, b) => syncRecordKey(a).localeCompare(syncRecordKey(b))) };
}
