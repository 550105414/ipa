import type { SQLiteDatabase } from 'expo-sqlite';

import { localDueToRemote, remoteDueToLocal } from '@/lib/date';
import { createSyncCoordinator } from '@/lib/sync-coordinator';
import { loadWorkspaceSession, workspaceJson, type WorkspaceSession } from '@/lib/workspace-api';

type RemoteTask = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  title: string;
  due_at: string | null;
  status: 'open' | 'done';
  created_at: string;
  completed_at: string | null;
};

type LocalSyncRow = {
  id: number;
  title: string;
  due_at: string | null;
  completed_at: string | null;
  remote_id: string | null;
  sync_state: 'pending' | 'synced' | 'local_only';
  updated_at: string;
  metadata_core_due_at: string | null;
  metadata_raw_due_at: string | null;
};

export type TaskSyncResult = {
  paired: boolean;
  pulled: number;
  pushed: number;
  remoteCount: number;
};

const syncByDatabase = new WeakMap<SQLiteDatabase, () => Promise<TaskSyncResult>>();
const TASK_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Reconciles the offline SQLite task list with the paired workspace.
 * Local pending changes win; otherwise the cloud copy wins. Star/category/notes
 * are reconciled separately by the authenticated encrypted account-sync layer.
 */
export async function syncWorkspaceTasks(database: SQLiteDatabase): Promise<TaskSyncResult> {
  let requestSync = syncByDatabase.get(database);
  if (!requestSync) {
    requestSync = createSyncCoordinator(() => performSync(database));
    syncByDatabase.set(database, requestSync);
  }
  return requestSync();
}

async function performSync(database: SQLiteDatabase): Promise<TaskSyncResult> {
  const storedSession = await loadWorkspaceSession();
  if (!storedSession) return { paired: false, pulled: 0, pushed: 0, remoteCount: 0 };
  const session = { ...storedSession };
  // Bind even basic-sync-only installations, before any task upload. Waiting
  // until the optional sync password is set leaves account switching unsafe.
  const account = await taskJson<{ scope: string }>('/api/mobile-sync', {}, session);
  if (!account || typeof account.scope !== 'string' || !/^[a-f0-9]{64}$/.test(account.scope)) throw new Error('服务器未确认账号同步范围，已停止上传，请升级或重新连接工作台。');
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync('PRAGMA busy_timeout = 5000;');
    await transaction.runAsync("INSERT OR IGNORE INTO app_metadata (key, value) VALUES ('account-sync.bound-scope', ?)", account.scope);
    const boundScope = await transaction.getFirstAsync<{ value: string }>("SELECT value FROM app_metadata WHERE key = 'account-sync.bound-scope'");
    if (!boundScope || account.scope !== boundScope.value) throw new Error('本机待办属于另一账号，已停止上传，请恢复原账号配对。');
  });

  const items = await fetchAllRemoteTasks(session);
  // Read SQLite after the slow request, rather than reconciling a snapshot
  // captured before the user edited a task during that request.
  const localRows = await database.getAllAsync<LocalSyncRow>(`
      SELECT id, title, due_at, completed_at, remote_id, sync_state, updated_at, metadata_core_due_at, metadata_raw_due_at
      FROM todo_items
      ORDER BY id ASC
    `);

  const remoteById = new Map(items.map((task) => [task.id, task]));
  const claimedRemoteIds = new Set<string>();
  let pulled = 0;
  let pushed = 0;
  let createdCount = 0;

  // First reconcile rows that already have a stable cloud identity.
  for (const local of localRows) {
    if (!local.remote_id) continue;
    const remote = remoteById.get(local.remote_id);
    if (!remote) {
      await handleMissingRemoteTask(database, local);
      continue;
    }

    claimedRemoteIds.add(remote.id);
    if (local.sync_state === 'pending') {
      const updated = await updateRemoteTask(local, session);
      await markSynced(database, local, updated.id);
      pushed += 1;
    } else {
      if (await applyRemoteTask(database, local, remote)) pulled += 1;
    }
  }

  // Pair identical unlinked rows before creating anything, preventing a first
  // sync from duplicating tasks that were entered once on each device.
  const unclaimedBySignature = new Map<string, RemoteTask[]>();
  for (const remote of items) {
    if (claimedRemoteIds.has(remote.id)) continue;
    const signature = taskSignature(remote.title, remoteDueToLocal(remote.due_at), remote.status);
    const matches = unclaimedBySignature.get(signature) ?? [];
    matches.push(remote);
    unclaimedBySignature.set(signature, matches);
  }

  for (const local of localRows) {
    if (local.remote_id || local.sync_state === 'local_only') continue;
    const signature = taskSignature(
      local.title,
      dueForCore(local),
      local.completed_at ? 'done' : 'open',
    );
    const matches = unclaimedBySignature.get(signature);
    const matched = matches?.shift();
    if (matched) {
      claimedRemoteIds.add(matched.id);
      if (await attachMatchedRemoteTask(database, local, matched)) pulled += 1;
      continue;
    }

    const created = await createRemoteTask(local, session);
    claimedRemoteIds.add(created.id);
    await markSynced(database, local, created.id);
    pushed += 1;
    createdCount += 1;
  }

  // Import cloud-only tasks. Re-running this is idempotent because remote_id is
  // protected by a partial unique index.
  for (const remote of items) {
    if (claimedRemoteIds.has(remote.id)) continue;
    await database.runAsync(
      `INSERT OR IGNORE INTO todo_items
        (title, notes, label, category_id, is_starred, due_at, completed_at,
         created_at, updated_at, remote_id, sync_state, last_synced_at, metadata_core_due_at, metadata_raw_due_at)
       VALUES (?, NULL, ?, 'work', 0, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'synced', CURRENT_TIMESTAMP, ?, ?)`,
      remote.title,
      remote.customer_name ? `客户：${remote.customer_name}` : '云端',
      remoteDueToLocal(remote.due_at),
      remote.status === 'done' ? remote.completed_at ?? remote.created_at : null,
      remote.created_at,
      remote.id,
      localDueToRemote(remote.due_at),
      remoteDueToLocal(remote.due_at),
    );
    pulled += 1;
  }

  return { paired: true, pulled, pushed, remoteCount: items.length + createdCount };
}

async function createRemoteTask(local: LocalSyncRow, session: WorkspaceSession): Promise<RemoteTask> {
  const { task } = await taskJson<{ task: RemoteTask }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: local.title,
      dueAt: dueForCore(local),
      status: local.completed_at ? 'done' : 'open',
    }),
  }, session);
  return task;
}

async function updateRemoteTask(local: LocalSyncRow, session: WorkspaceSession): Promise<RemoteTask> {
  if (!local.remote_id) throw new Error('云端待办缺少标识');
  const { task } = await taskJson<{ task: RemoteTask }>(
    `/api/tasks/${encodeURIComponent(local.remote_id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        title: local.title,
        dueAt: dueForCore(local),
        status: local.completed_at ? 'done' : 'open',
      }),
    }, session,
  );
  return task;
}

async function fetchAllRemoteTasks(session: WorkspaceSession): Promise<RemoteTask[]> {
  const tasks: RemoteTask[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const search = new URLSearchParams({ pageSize: '200' });
    if (cursor) search.set('cursor', cursor);
    const page = await taskJson<{ items: RemoteTask[]; nextCursor: string | null }>(
      `/api/tasks?${search.toString()}`,
      {}, session,
    );
    tasks.push(...page.items);
    cursor = page.nextCursor;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error('云端待办分页游标重复');
      seenCursors.add(cursor);
    }
  } while (cursor);

  return tasks;
}

async function taskJson<T>(path: string, init: RequestInit = {}, session: WorkspaceSession): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TASK_REQUEST_TIMEOUT_MS);
  try {
    return await workspaceJson<T>(path, { ...init, signal: controller.signal }, session);
  } finally {
    clearTimeout(timeout);
  }
}

async function markSynced(
  database: SQLiteDatabase,
  local: LocalSyncRow,
  remoteId: string,
) {
  await database.runAsync(
    `UPDATE todo_items
     SET remote_id = ?,
         sync_state = CASE
           WHEN updated_at = ? AND title = ? AND due_at IS ? AND completed_at IS ?
           THEN 'synced' ELSE 'pending' END,
         last_synced_at = CURRENT_TIMESTAMP,
         metadata_core_due_at = CASE WHEN due_at IS ? THEN ? ELSE metadata_core_due_at END,
         metadata_raw_due_at = CASE WHEN due_at IS ? THEN ? ELSE metadata_raw_due_at END
     WHERE id = ? AND (remote_id IS NULL OR remote_id = ?)`,
    remoteId,
    local.updated_at,
    local.title,
    local.due_at,
    local.completed_at,
    local.due_at,
    dueForCore(local),
    local.due_at,
    local.due_at,
    local.id,
    remoteId,
  );
}

async function applyRemoteTask(
  database: SQLiteDatabase,
  local: LocalSyncRow,
  remote: RemoteTask,
): Promise<boolean> {
  const dueAt = preserveEquivalentLocalDue(local.due_at, remote.due_at, local.metadata_raw_due_at === local.due_at ? local.metadata_core_due_at : null);
  const result = await database.runAsync(
    `UPDATE todo_items
     SET title = ?,
         label = COALESCE(?, label),
         due_at = ?,
         metadata_core_due_at = ?,
         metadata_raw_due_at = ?,
         recurrence_anchor_due_at = CASE
           WHEN repeat_rule != 'none' AND due_at IS NOT ? THEN ?
           ELSE recurrence_anchor_due_at END,
         repeat_rule = CASE WHEN ? IS NULL THEN 'none' ELSE repeat_rule END,
         completed_at = ?,
         remote_id = ?,
         sync_state = 'synced',
         last_synced_at = CURRENT_TIMESTAMP
     WHERE id = ? AND sync_state = 'synced' AND updated_at = ?
       AND title = ? AND due_at IS ? AND completed_at IS ?`,
    remote.title,
    remote.customer_name ? `客户：${remote.customer_name}` : null,
    dueAt,
    localDueToRemote(remote.due_at),
    dueAt,
    dueAt,
    dueAt,
    dueAt,
    remote.status === 'done' ? remote.completed_at ?? remote.created_at : null,
    remote.id,
    local.id,
    local.updated_at,
    local.title,
    local.due_at,
    local.completed_at,
  );
  return result.changes > 0;
}

async function attachMatchedRemoteTask(
  database: SQLiteDatabase,
  local: LocalSyncRow,
  remote: RemoteTask,
): Promise<boolean> {
  const dueAt = preserveEquivalentLocalDue(local.due_at, remote.due_at, local.metadata_raw_due_at === local.due_at ? local.metadata_core_due_at : null);
  // Keep the stable cloud identity even if a local edit raced the first
  // matching request. The guarded second update must not overwrite that edit.
  await database.runAsync(
    'UPDATE todo_items SET remote_id = ? WHERE id = ? AND remote_id IS NULL',
    remote.id,
    local.id,
  );
  const result = await database.runAsync(
    `UPDATE todo_items
     SET label = COALESCE(?, label),
         due_at = ?,
         metadata_core_due_at = ?,
         metadata_raw_due_at = ?,
         sync_state = 'synced',
         last_synced_at = CURRENT_TIMESTAMP
     WHERE id = ? AND remote_id = ? AND updated_at = ?
       AND title = ? AND due_at IS ? AND completed_at IS ?`,
    remote.customer_name ? `客户：${remote.customer_name}` : null,
    dueAt,
    localDueToRemote(remote.due_at),
    dueAt,
    local.id,
    remote.id,
    local.updated_at,
    local.title,
    local.due_at,
    local.completed_at,
  );
  if (result.changes === 0) {
    await database.runAsync(
      "UPDATE todo_items SET sync_state = 'pending' WHERE id = ? AND remote_id = ?",
      local.id,
      remote.id,
    );
  }
  return result.changes > 0;
}

async function handleMissingRemoteTask(database: SQLiteDatabase, local: LocalSyncRow) {
  const deleted = await database.runAsync(
    `DELETE FROM todo_items
     WHERE id = ? AND remote_id = ? AND sync_state = 'synced' AND updated_at = ?
       AND title = ? AND due_at IS ? AND completed_at IS ?`,
    local.id,
    local.remote_id,
    local.updated_at,
    local.title,
    local.due_at,
    local.completed_at,
  );
  if (deleted.changes > 0) return;

  // A local edit raced a remote deletion. Preserve it on this device but do
  // not silently recreate the deleted cloud task. Editing it again explicitly
  // changes sync_state back to pending and creates a new cloud task.
  await database.runAsync(
    `UPDATE todo_items
     SET remote_id = NULL, sync_state = 'local_only', last_synced_at = NULL
     WHERE id = ? AND remote_id = ?`,
    local.id,
    local.remote_id,
  );
}

function taskSignature(title: string, dueAt: string | null, status: 'open' | 'done') {
  return `${title.trim().toLocaleLowerCase()}\u0000${localDueToRemote(dueAt) ?? dueAt ?? ''}\u0000${status}`;
}

/** A date-only due date must stay date-only after its equivalent cloud round trip. */
function preserveEquivalentLocalDue(localDueAt: string | null, remoteDueAt: string | null, boundCoreDueAt: string | null = null) {
  const normalizedLocal = localDueToRemote(localDueAt);
  const normalizedRemote = localDueToRemote(remoteDueAt);
  if (normalizedLocal !== null && normalizedLocal === normalizedRemote) return localDueAt;
  if (localDueAt?.trim().length === 10 && boundCoreDueAt !== null && localDueToRemote(boundCoreDueAt) === normalizedRemote) return localDueAt;
  return remoteDueToLocal(remoteDueAt);
}

/** Keep an imported all-day calendar date tied to its original cloud instant across timezones. */
function dueForCore(local: LocalSyncRow): string | null {
  return local.due_at?.trim().length === 10 && local.metadata_core_due_at && local.metadata_raw_due_at === local.due_at
    ? localDueToRemote(local.metadata_core_due_at) : localDueToRemote(local.due_at);
}
