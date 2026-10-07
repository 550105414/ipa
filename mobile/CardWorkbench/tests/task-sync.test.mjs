import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTypeScript } from './helpers/load-typescript.mjs';
import { createDatabase } from './helpers/sqlite-bridge.mjs';

process.env.TZ = 'Asia/Shanghai';
const date = await loadTypeScript('src/lib/date.ts');
const recurrence = await loadTypeScript('src/lib/task-recurrence.ts', { '@/lib/date': date });
const databaseFunctions = await loadTypeScript('src/lib/database.ts', {
  '@/lib/date': date, '@/lib/task-recurrence': recurrence,
});
const coordinator = await loadTypeScript('src/lib/sync-coordinator.ts');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const remoteTask = (overrides = {}) => ({
  id: 'remote-1', customer_id: null, customer_name: null, title: '已有待办',
  due_at: '2026-11-05T16:00:00.000Z', status: 'open',
  created_at: '2026-10-07T00:00:00.000Z', completed_at: null, ...overrides,
});

function createServer(initial = [], intercept = async () => undefined) {
  const tasks = new Map(initial.map((item) => [item.id, { ...item }]));
  const requests = [];
  let nextId = 100;
  const workspaceJson = async (path, init = {}) => {
    const request = { path, method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : null };
    requests.push(request);
    await intercept(request);
    if (request.method === 'GET') {
      return { items: structuredClone([...tasks.values()]), nextCursor: null };
    }
    const id = request.method === 'POST' ? `created-${nextId++}` : path.split('/').at(-1);
    const item = remoteTask({ ...tasks.get(id), id, title: request.body.title,
      due_at: request.body.dueAt, status: request.body.status,
      completed_at: request.body.status === 'done' ? '2026-10-07T01:00:00.000Z' : null });
    tasks.set(id, item);
    return { task: { ...item } };
  };
  return { tasks, requests, workspaceJson };
}

async function syncModule(server) {
  return loadTypeScript('src/lib/task-sync.ts', {
    '@/lib/date': date, '@/lib/sync-coordinator': coordinator,
    '@/lib/workspace-api': {
      loadWorkspaceSession: async () => ({ baseUrl: 'https://example.invalid' }),
      workspaceJson: server.workspaceJson,
    },
  });
}

async function seededDatabase(t, overrides = {}) {
  const db = createDatabase(t);
  await databaseFunctions.migrateDatabase(db);
  const { lastInsertRowId: id } = await databaseFunctions.insertTask(db, {
    title: '已有待办', notes: '仅本机备注', categoryId: 'inbox', isStarred: true,
    dueAt: '2026-11-06', repeatRule: 'monthly', ...overrides,
  });
  return { db, id };
}

test('coordinator reruns the latest snapshot after concurrent requests, without parallel passes', async () => {
  const firstPass = deferred();
  let latest = 'first';
  const values = [];
  let active = 0;
  let maximumActive = 0;
  const request = coordinator.createSyncCoordinator(async () => {
    maximumActive = Math.max(maximumActive, ++active);
    const value = latest;
    values.push(value);
    if (values.length === 1) await firstPass.promise;
    active -= 1;
    return value;
  });
  const first = request();
  await Promise.resolve();
  latest = 'newest';
  const second = request();
  const third = request();
  firstPass.resolve();
  assert.deepEqual(await Promise.all([first, second, third]), ['newest', 'newest', 'newest']);
  assert.deepEqual(values, ['first', 'newest']);
  assert.equal(maximumActive, 1);
});

test('a request in the same completion tick starts a pass rather than joining an already-finished pass', async () => {
  const pass = deferred();
  let count = 0;
  const request = coordinator.createSyncCoordinator(() => ++count === 1 ? pass.promise : Promise.resolve(count));
  const first = request();
  await Promise.resolve();
  // Registered after drain's await handler, but before its shared promise settles.
  const later = pass.promise.then(() => request());
  pass.resolve(1);
  assert.deepEqual(await Promise.all([first, later]), [1, 2]);
  assert.equal(count, 2);
});

test('failure releases the coordinator atomically and a later request can retry', async () => {
  const pass = deferred();
  let count = 0;
  const request = coordinator.createSyncCoordinator(() => ++count === 1 ? pass.promise : Promise.resolve('retried'));
  const first = request();
  const failed = assert.rejects(first, /offline/);
  await Promise.resolve();
  const later = pass.promise.catch(() => request());
  pass.reject(new Error('offline'));
  await failed;
  assert.equal(await later, 'retried');
  assert.equal(count, 2);
});

test('synchronous throws and a failed pass with an already-queued edit remain retryable', async () => {
  let count = 0;
  const request = coordinator.createSyncCoordinator(() => {
    if (++count === 1) throw new Error('first failure');
    return Promise.resolve('saved');
  });
  await assert.rejects(request(), /first failure/);
  assert.equal(await request(), 'saved');
  const pass = deferred();
  count = 0;
  const queued = coordinator.createSyncCoordinator(() => ++count === 1 ? pass.promise : Promise.resolve('newest saved'));
  const first = queued();
  await Promise.resolve();
  const second = queued();
  pass.reject(new Error('temporary outage'));
  assert.deepEqual(await Promise.all([first, second]), ['newest saved', 'newest saved']);
});

test('an edit during a delayed PATCH stays pending and is uploaded in a fresh pass even with the same timestamp', async (t) => {
  const { db, id } = await seededDatabase(t);
  await db.runAsync("UPDATE todo_items SET remote_id = 'remote-1', updated_at = 'same-timestamp' WHERE id = ?", id);
  const started = deferred();
  const release = deferred();
  let patches = 0;
  const server = createServer([remoteTask()], async (request) => {
    if (request.method === 'PATCH' && patches++ === 0) {
      started.resolve();
      await release.promise;
    }
  });
  const { syncWorkspaceTasks } = await syncModule(server);
  const first = syncWorkspaceTasks(db);
  await started.promise;
  await db.runAsync("UPDATE todo_items SET title = '最后一次编辑', due_at = '2026-11-07', sync_state = 'pending' WHERE id = ?", id);
  const second = syncWorkspaceTasks(db);
  release.resolve();
  await Promise.all([first, second]);
  const row = await db.getFirstAsync('SELECT * FROM todo_items WHERE id = ?', id);
  assert.equal(row.title, '最后一次编辑');
  assert.equal(row.due_at, '2026-11-07');
  assert.equal(row.sync_state, 'synced');
  assert.equal(row.notes, '仅本机备注');
  assert.equal(server.tasks.get('remote-1').title, '最后一次编辑');
  assert.equal(server.tasks.get('remote-1').due_at, '2026-11-06T16:00:00.000Z');
  assert.equal(server.requests.filter((item) => item.method === 'PATCH').length, 2);
});

test('a new task and another edit during a delayed POST are not lost or duplicated', async (t) => {
  const { db, id } = await seededDatabase(t);
  const started = deferred();
  const release = deferred();
  let posts = 0;
  const server = createServer([], async (request) => {
    if (request.method === 'POST' && posts++ === 0) {
      started.resolve();
      await release.promise;
    }
  });
  const { syncWorkspaceTasks } = await syncModule(server);
  const first = syncWorkspaceTasks(db);
  await started.promise;
  await databaseFunctions.updateTask(db, { id, title: '原待办的新标题', categoryId: 'inbox',
    dueAt: '2026-11-08', isStarred: true, repeatRule: 'monthly' });
  await databaseFunctions.insertTask(db, { title: '同步期间新增', categoryId: 'work',
    dueAt: null, isStarred: false });
  const second = syncWorkspaceTasks(db);
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(server.tasks.size, 2);
  assert.deepEqual([...server.tasks.values()].map((item) => item.title).sort(),
    ['原待办的新标题', '同步期间新增'].sort());
  assert.equal(server.requests.filter((item) => item.method === 'POST').length, 2);
  assert.equal(server.requests.filter((item) => item.method === 'PATCH').length, 1);
  const rows = await db.getAllAsync('SELECT * FROM todo_items');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.sync_state === 'synced' && row.remote_id));
});

test('slow GET uses a fresh SQLite snapshot and cannot replace a local edit', async (t) => {
  const { db, id } = await seededDatabase(t);
  await db.runAsync("UPDATE todo_items SET remote_id = 'remote-1', sync_state = 'synced' WHERE id = ?", id);
  const started = deferred();
  const release = deferred();
  let gets = 0;
  const server = createServer([remoteTask({ title: '旧的云端标题' })], async (request) => {
    if (request.method === 'GET' && gets++ === 0) {
      started.resolve();
      await release.promise;
    }
  });
  const { syncWorkspaceTasks } = await syncModule(server);
  const operation = syncWorkspaceTasks(db);
  await started.promise;
  await databaseFunctions.updateTask(db, { id, title: '网络等待期间编辑', categoryId: 'inbox',
    dueAt: '2026-11-06', isStarred: true, repeatRule: 'monthly' });
  release.resolve();
  await operation;
  assert.equal((await db.getFirstAsync('SELECT title FROM todo_items WHERE id = ?', id)).title, '网络等待期间编辑');
  assert.equal(server.tasks.get('remote-1').title, '网络等待期间编辑');
});

test('equivalent cloud due dates keep local all-day and offset semantics and recurrence anchors', async (t) => {
  const { db, id } = await seededDatabase(t);
  await db.runAsync("UPDATE todo_items SET remote_id = 'remote-1', sync_state = 'synced' WHERE id = ?", id);
  const server = createServer([remoteTask()]);
  const { syncWorkspaceTasks } = await syncModule(server);
  await syncWorkspaceTasks(db);
  let row = await db.getFirstAsync('SELECT * FROM todo_items WHERE id = ?', id);
  assert.equal(row.due_at, '2026-11-06');
  assert.equal(row.repeat_rule, 'monthly');
  assert.equal(row.recurrence_anchor_due_at, '2026-11-06');
  await db.runAsync("UPDATE todo_items SET due_at = '2026-11-06T15:30:00+08:00', recurrence_anchor_due_at = '2026-11-06T15:30:00+08:00' WHERE id = ?", id);
  server.tasks.get('remote-1').due_at = '2026-11-06T07:30:00.000Z';
  await syncWorkspaceTasks(db);
  row = await db.getFirstAsync('SELECT * FROM todo_items WHERE id = ?', id);
  assert.equal(row.due_at, '2026-11-06T15:30:00+08:00');
  assert.equal(row.recurrence_anchor_due_at, '2026-11-06T15:30:00+08:00');
  server.tasks.get('remote-1').due_at = '2026-11-09T03:00:00.000Z';
  await syncWorkspaceTasks(db);
  row = await db.getFirstAsync('SELECT * FROM todo_items WHERE id = ?', id);
  assert.equal(row.due_at, '2026-11-09T03:00:00.000Z');
  assert.equal(row.recurrence_anchor_due_at, row.due_at);
  assert.equal(row.repeat_rule, 'monthly');
});

test('first matching sync preserves date-only reminders without duplicating an existing cloud task', async (t) => {
  const { db, id } = await seededDatabase(t);
  const server = createServer([remoteTask()]);
  const { syncWorkspaceTasks } = await syncModule(server);
  await syncWorkspaceTasks(db);
  const row = await db.getFirstAsync('SELECT * FROM todo_items WHERE id = ?', id);
  assert.equal(row.remote_id, 'remote-1');
  assert.equal(row.due_at, '2026-11-06');
  assert.equal(row.sync_state, 'synced');
  assert.equal(server.requests.filter((item) => item.method !== 'GET').length, 0);
});

test('failed sync leaves pending edits intact and an explicit retry uploads them', async (t) => {
  const { db, id } = await seededDatabase(t);
  let fail = true;
  const server = createServer([], async () => {
    if (fail) throw new Error('offline');
  });
  const { syncWorkspaceTasks } = await syncModule(server);
  await assert.rejects(syncWorkspaceTasks(db), /offline/);
  assert.equal((await db.getFirstAsync('SELECT sync_state FROM todo_items WHERE id = ?', id)).sync_state, 'pending');
  fail = false;
  await syncWorkspaceTasks(db);
  assert.equal(server.tasks.size, 1);
  assert.equal((await db.getFirstAsync('SELECT sync_state FROM todo_items WHERE id = ?', id)).sync_state, 'synced');
});
