import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

import { createDatabase } from './helpers/sqlite-bridge.mjs';

async function sourceModuleUrl(relativePath, imports = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  for (const [specifier, url] of Object.entries(imports)) {
    outputText = outputText.replaceAll(`from '${specifier}'`, `from '${url}'`);
  }
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const dateUrl = await sourceModuleUrl('../src/lib/date.ts');
const recurrenceUrl = await sourceModuleUrl('../src/lib/task-recurrence.ts', { '@/lib/date': dateUrl });
const databaseUrl = await sourceModuleUrl('../src/lib/database.ts', {
  '@/lib/date': dateUrl, '@/lib/task-recurrence': recurrenceUrl,
});
const databaseFunctions = await import(databaseUrl);

const input = (overrides = {}) => ({ title: '每月还款', notes: '保留备注', categoryId: 'inbox',
  isStarred: true, dueAt: '2096-01-31', repeatRule: 'monthly', ...overrides });

test('fresh migration creates no demo todos and recurrence defaults to none', async (t) => {
  const db = createDatabase(t);
  await databaseFunctions.migrateDatabase(db);
  assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, 6);
  assert.equal((await databaseFunctions.getTasks(db)).length, 0);
  const result = await databaseFunctions.insertTask(db, input({ repeatRule: undefined }));
  const task = (await databaseFunctions.getTasks(db))[0];
  assert.equal(task.id, result.lastInsertRowId);
  assert.equal(task.repeatRule, 'none');
});

test('version 5 upgrade preserves existing task data and credentials', async (t) => {
  const db = createDatabase(t);
  await databaseFunctions.migrateDatabase(db);
  await db.execAsync(`DROP INDEX todo_items_recurrence_parent_index;
    ALTER TABLE todo_items DROP COLUMN repeat_rule;
    ALTER TABLE todo_items DROP COLUMN recurrence_anchor_due_at;
    ALTER TABLE todo_items DROP COLUMN recurrence_parent_id;
    PRAGMA user_version = 5;`);
  await db.runAsync(`INSERT INTO todo_items (title, notes, category_id, due_at, remote_id, sync_state)
    VALUES ('已有待办', '不能丢失', 'work', '2026-11-06', 'server-task', 'synced')`);
  await db.runAsync(`INSERT INTO credential_entries
    (id, platform_name, category_id, encrypted_payload, created_at, updated_at)
    VALUES ('saved', '保留账户', 'work', 'encrypted', '2026-10-07', '2026-10-07')`);
  await databaseFunctions.migrateDatabase(db);
  const row = await db.getFirstAsync('SELECT * FROM todo_items');
  assert.equal(row.title, '已有待办');
  assert.equal(row.notes, '不能丢失');
  assert.equal(row.due_at, '2026-11-06');
  assert.equal(row.remote_id, 'server-task');
  assert.equal(row.sync_state, 'synced');
  assert.equal(row.repeat_rule, 'none');
  assert.equal((await db.getAllAsync('SELECT * FROM credential_entries')).length, 1);
  await databaseFunctions.migrateDatabase(db);
  assert.equal((await db.getAllAsync('SELECT * FROM todo_items')).length, 1);
});

test('an interrupted version 6 migration resumes without duplicate columns or loss', async (t) => {
  const db = createDatabase(t);
  await databaseFunctions.migrateDatabase(db);
  await databaseFunctions.insertTask(db, input());
  await db.execAsync('ALTER TABLE todo_items DROP COLUMN recurrence_anchor_due_at; PRAGMA user_version = 5;');
  await databaseFunctions.migrateDatabase(db);
  assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, 6);
  assert.equal((await databaseFunctions.getTasks(db))[0].title, '每月还款');
});

test('completion keeps its history and generates one child with the original monthly anchor', async (t) => {
  const db = createDatabase(t);
  await databaseFunctions.migrateDatabase(db);
  const { lastInsertRowId: id } = await databaseFunctions.insertTask(db, input());
  await databaseFunctions.toggleTaskCompletion(db, id);
  const rows = await db.getAllAsync('SELECT * FROM todo_items ORDER BY id');
  assert.equal(rows.length, 2);
  assert.ok(rows[0].completed_at);
  assert.equal(rows[1].completed_at, null);
  assert.equal(rows[1].due_at, '2096-02-29');
  assert.equal(rows[1].notes, '保留备注');
  assert.equal(rows[1].is_starred, 1);
  assert.equal(rows[1].remote_id, null);
  assert.equal(rows[1].sync_state, 'pending');
  assert.equal(rows[1].recurrence_parent_id, id);
  assert.equal(rows[1].recurrence_anchor_due_at, '2096-01-31');
  await databaseFunctions.toggleTaskCompletion(db, rows[1].id);
  const grandchild = await db.getFirstAsync('SELECT * FROM todo_items WHERE recurrence_parent_id = ?', rows[1].id);
  assert.equal(grandchild.due_at, '2096-03-31');
});

test('rapid undo/re-complete reuses its generated child and never deletes an edited occurrence', async (t) => {
  const db = createDatabase(t);
  await databaseFunctions.migrateDatabase(db);
  const { lastInsertRowId: id } = await databaseFunctions.insertTask(db, input());
  await databaseFunctions.toggleTaskCompletion(db, id);
  const child = await db.getFirstAsync('SELECT * FROM todo_items WHERE recurrence_parent_id = ?', id);
  await databaseFunctions.updateTask(db, { ...input({ title: '用户已改下一期', dueAt: child.due_at }), id: child.id });
  await Promise.all(Array.from({ length: 10 }, () => databaseFunctions.toggleTaskCompletion(db, id)));
  const rows = await db.getAllAsync('SELECT * FROM todo_items');
  assert.equal(rows.length, 2);
  assert.ok(rows.find((row) => row.id === id).completed_at);
  assert.equal(rows.find((row) => row.id === child.id).title, '用户已改下一期');
  await databaseFunctions.toggleTaskCompletion(db, child.id);
  await databaseFunctions.toggleTaskCompletion(db, id);
  await databaseFunctions.toggleTaskCompletion(db, id);
  assert.equal((await db.getAllAsync('SELECT * FROM todo_items')).length, 3);
});

test('editing title preserves the monthly anchor; changing cadence/date resets it and removing date disables it', async (t) => {
  const db = createDatabase(t);
  await databaseFunctions.migrateDatabase(db);
  const { lastInsertRowId: id } = await databaseFunctions.insertTask(db, input());
  await databaseFunctions.toggleTaskCompletion(db, id);
  const child = await db.getFirstAsync('SELECT * FROM todo_items WHERE recurrence_parent_id = ?', id);
  await databaseFunctions.updateTask(db, { ...input({ title: '新标题', dueAt: child.due_at, repeatRule: undefined }), id: child.id });
  assert.equal((await db.getFirstAsync('SELECT * FROM todo_items WHERE id = ?', child.id)).recurrence_anchor_due_at, '2096-01-31');
  await databaseFunctions.updateTask(db, { ...input({ dueAt: '2096-02-15' }), id: child.id });
  assert.equal((await db.getFirstAsync('SELECT * FROM todo_items WHERE id = ?', child.id)).recurrence_anchor_due_at, '2096-02-15');
  await databaseFunctions.updateTask(db, { ...input({ dueAt: null, repeatRule: undefined }), id: child.id });
  const noDate = await db.getFirstAsync('SELECT * FROM todo_items WHERE id = ?', child.id);
  assert.equal(noDate.repeat_rule, 'none');
  assert.equal(noDate.recurrence_anchor_due_at, null);
  await assert.rejects(databaseFunctions.insertTask(db, input({ dueAt: null })), /有效日期/);
});

test('if next-occurrence insertion fails, completion rolls back with no lost task', async (t) => {
  const db = createDatabase(t);
  await databaseFunctions.migrateDatabase(db);
  const { lastInsertRowId: id } = await databaseFunctions.insertTask(db, input());
  await db.execAsync(`CREATE TRIGGER fail_recurrence BEFORE INSERT ON todo_items
    WHEN NEW.recurrence_parent_id IS NOT NULL BEGIN
    SELECT RAISE(ABORT, 'test insertion failure'); END;`);
  await assert.rejects(databaseFunctions.toggleTaskCompletion(db, id), /test insertion failure/);
  const rows = await db.getAllAsync('SELECT * FROM todo_items');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].completed_at, null);
});
