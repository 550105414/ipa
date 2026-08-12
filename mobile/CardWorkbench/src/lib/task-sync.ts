import type { SQLiteDatabase } from 'expo-sqlite';

import { loadWorkspaceSession, workspaceJson } from '@/lib/workspace-api';

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
};

export type TaskSyncResult = {
  paired: boolean;
  pulled: number;
  pushed: number;
  remoteCount: number;
};

const syncByDatabase = new WeakMap<SQLiteDatabase, Promise<TaskSyncResult>>();

/**
 * Reconciles the offline SQLite task list with the paired workspace.
 * Local pending changes win; otherwise the cloud copy wins. Star/category/notes
 * remain device-local because the current cloud task model does not expose them.
 */
export async function syncWorkspaceTasks(database: SQLiteDatabase): Promise<TaskSyncResult> {
  const running = syncByDatabase.get(database);
  if (running) return running;

  const operation = performSync(database).finally(() => {
    if (syncByDatabase.get(database) === operation) syncByDatabase.delete(database);
  });
  syncByDatabase.set(database, operation);
  return operation;
}

async function performSync(database: SQLiteDatabase): Promise<TaskSyncResult> {
  const session = await loadWorkspaceSession();
  if (!session) return { paired: false, pulled: 0, pushed: 0, remoteCount: 0 };

  const [items, localRows] = await Promise.all([
    fetchAllRemoteTasks(),
    database.getAllAsync<LocalSyncRow>(`
      SELECT id, title, due_at, completed_at, remote_id, sync_state, updated_at
      FROM todo_items
      ORDER BY id ASC
    `),
  ]);

  const remoteById = new Map(items.map((task) => [task.id, task]));
  const claimedRemoteIds = new Set<string>();
  let pulled = 0;
  let pushed = 0;

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
      const updated = await updateRemoteTask(local);
      await markSynced(database, local.id, updated.id, local.updated_at);
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
      local.due_at,
      local.completed_at ? 'done' : 'open',
    );
    const matches = unclaimedBySignature.get(signature);
    const matched = matches?.shift();
    if (matched) {
      claimedRemoteIds.add(matched.id);
      if (await attachMatchedRemoteTask(database, local, matched)) pulled += 1;
      continue;
    }

    const created = await createRemoteTask(local);
    claimedRemoteIds.add(created.id);
    await markSynced(database, local.id, created.id, local.updated_at);
    pushed += 1;
  }

  // Import cloud-only tasks. Re-running this is idempotent because remote_id is
  // protected by a partial unique index.
  for (const remote of items) {
    if (claimedRemoteIds.has(remote.id)) continue;
    await database.runAsync(
      `INSERT OR IGNORE INTO todo_items
        (title, notes, label, category_id, is_starred, due_at, completed_at,
         created_at, updated_at, remote_id, sync_state, last_synced_at)
       VALUES (?, NULL, ?, 'work', 0, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'synced', CURRENT_TIMESTAMP)`,
      remote.title,
      remote.customer_name ? `客户：${remote.customer_name}` : '云端',
      remoteDueToLocal(remote.due_at),
      remote.status === 'done' ? remote.completed_at ?? remote.created_at : null,
      remote.created_at,
      remote.id,
    );
    pulled += 1;
  }

  return { paired: true, pulled, pushed, remoteCount: items.length };
}

async function createRemoteTask(local: LocalSyncRow): Promise<RemoteTask> {
  const { task } = await workspaceJson<{ task: RemoteTask }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: local.title,
      dueAt: localDueToRemote(local.due_at),
      status: local.completed_at ? 'done' : 'open',
    }),
  });
  return task;
}

async function updateRemoteTask(local: LocalSyncRow): Promise<RemoteTask> {
  if (!local.remote_id) throw new Error('云端待办缺少标识');
  const { task } = await workspaceJson<{ task: RemoteTask }>(
    `/api/tasks/${encodeURIComponent(local.remote_id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        title: local.title,
        dueAt: localDueToRemote(local.due_at),
        status: local.completed_at ? 'done' : 'open',
      }),
    },
  );
  return task;
}

async function fetchAllRemoteTasks(): Promise<RemoteTask[]> {
  const tasks: RemoteTask[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const search = new URLSearchParams({ pageSize: '200' });
    if (cursor) search.set('cursor', cursor);
    const page = await workspaceJson<{ items: RemoteTask[]; nextCursor: string | null }>(
      `/api/tasks?${search.toString()}`,
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

async function markSynced(
  database: SQLiteDatabase,
  localId: number,
  remoteId: string,
  expectedUpdatedAt: string,
) {
  await database.runAsync(
    `UPDATE todo_items
     SET remote_id = ?,
         sync_state = CASE WHEN updated_at = ? THEN 'synced' ELSE 'pending' END,
         last_synced_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    remoteId,
    expectedUpdatedAt,
    localId,
  );
}

async function applyRemoteTask(
  database: SQLiteDatabase,
  local: LocalSyncRow,
  remote: RemoteTask,
): Promise<boolean> {
  const result = await database.runAsync(
    `UPDATE todo_items
     SET title = ?,
         label = COALESCE(?, label),
         due_at = ?,
         completed_at = ?,
         remote_id = ?,
         sync_state = 'synced',
         last_synced_at = CURRENT_TIMESTAMP
     WHERE id = ? AND sync_state = 'synced' AND updated_at = ?`,
    remote.title,
    remote.customer_name ? `客户：${remote.customer_name}` : null,
    remoteDueToLocal(remote.due_at),
    remote.status === 'done' ? remote.completed_at ?? remote.created_at : null,
    remote.id,
    local.id,
    local.updated_at,
  );
  return result.changes > 0;
}

async function attachMatchedRemoteTask(
  database: SQLiteDatabase,
  local: LocalSyncRow,
  remote: RemoteTask,
): Promise<boolean> {
  const result = await database.runAsync(
    `UPDATE todo_items
     SET title = CASE WHEN updated_at = ? THEN ? ELSE title END,
         label = CASE WHEN updated_at = ? THEN COALESCE(?, label) ELSE label END,
         due_at = CASE WHEN updated_at = ? THEN ? ELSE due_at END,
         completed_at = CASE WHEN updated_at = ? THEN ? ELSE completed_at END,
         remote_id = ?,
         sync_state = CASE WHEN updated_at = ? THEN 'synced' ELSE 'pending' END,
         last_synced_at = CURRENT_TIMESTAMP
     WHERE id = ? AND remote_id IS NULL`,
    local.updated_at,
    remote.title,
    local.updated_at,
    remote.customer_name ? `客户：${remote.customer_name}` : null,
    local.updated_at,
    remoteDueToLocal(remote.due_at),
    local.updated_at,
    remote.status === 'done' ? remote.completed_at ?? remote.created_at : null,
    remote.id,
    local.updated_at,
    local.id,
  );
  return result.changes > 0;
}

async function handleMissingRemoteTask(database: SQLiteDatabase, local: LocalSyncRow) {
  const deleted = await database.runAsync(
    `DELETE FROM todo_items
     WHERE id = ? AND remote_id = ? AND sync_state = 'synced' AND updated_at = ?`,
    local.id,
    local.remote_id,
    local.updated_at,
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
  return `${title.trim().toLocaleLowerCase()}\u0000${dueAt ?? ''}\u0000${status}`;
}

function localDueToRemote(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const value = new Date(`${dueAt}T12:00:00`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function remoteDueToLocal(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const value = new Date(dueAt);
  if (Number.isNaN(value.getTime())) return null;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
