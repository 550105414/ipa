import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import { loadTypeScript } from './helpers/load-typescript.mjs';
import { createDatabase } from './helpers/sqlite-bridge.mjs';

const hashes = await import('@noble/hashes/sha2.js');
const utils = await import('@noble/hashes/utils.js');
const ciphers = await import('@noble/ciphers/aes.js');
const pbkdf2 = await import('@noble/hashes/pbkdf2.js');
const model = await loadTypeScript('src/lib/account-sync-model.ts', { '@noble/hashes/sha2.js': hashes, '@noble/hashes/utils.js': utils });
const crypto = await loadTypeScript('src/lib/account-sync-crypto.ts', {
  '@noble/ciphers/aes.js': ciphers, '@noble/hashes/pbkdf2.js': pbkdf2, '@noble/hashes/sha2.js': hashes, '@noble/hashes/utils.js': utils,
  './account-sync-model': model,
});
const dates = await loadTypeScript('src/lib/date.ts');
const recurrence = await loadTypeScript('src/lib/task-recurrence.ts', { '@/lib/date': dates });
const databaseApi = await loadTypeScript('src/lib/database.ts', { '@/lib/date': dates, '@/lib/task-recurrence': recurrence });
const scope = 'a'.repeat(64);
const password = '独立同步密码-2026-Test!';
const newPassword = '新的同步密码-2026-Test!';
const entryId = '12345678-1234-4123-8123-123456789012';
const secret = { account: '私人账户', password: '只应存在密文内的密码', email: 'owner@example.com', nickname: '昵称', website: 'https://example.com', notes: '个人备注', tags: ['工作', '重要'] };
const credential = (patch = {}) => ({ kind: 'credential', id: entryId, deleted: false, data: { platformName: '平台', categoryId: 'work', icon: 'key.fill', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z', secret: { ...secret }, ...patch } });
const document = (...records) => ({ version: 1, records });
const baseline = (record) => ({ kind: record.kind, id: record.id, local_hash: model.syncFingerprint(record), remote_hash: model.syncFingerprint(record) });
const rng = async (length) => new Uint8Array(randomBytes(length));

test('real Noble PBKDF2/AES-GCM interoperates with independent Node crypto and preserves every secret field', async () => {
  const input = document(credential());
  const envelope = await crypto.encryptSyncDocument(password, scope, input, rng);
  const key = pbkdf2Sync(password, Buffer.from(envelope.salt, 'base64'), 310000, 32, 'sha256');
  const combined = Buffer.from(envelope.ciphertext, 'base64');
  const nodeDecipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'));
  nodeDecipher.setAAD(Buffer.from(`cardworkbench-sync|v1|${scope}`));
  nodeDecipher.setAuthTag(combined.subarray(-16));
  const plaintext = Buffer.concat([nodeDecipher.update(combined.subarray(0, -16)), nodeDecipher.final()]);
  assert.deepEqual(JSON.parse(plaintext), input);
  assert.deepEqual(await crypto.decryptSyncDocument(password, scope, envelope), input);
  assert.equal(JSON.stringify(envelope).includes(secret.password), false);
  const nodeNonce = randomBytes(12);
  const nodeCipher = createCipheriv('aes-256-gcm', key, nodeNonce);
  nodeCipher.setAAD(Buffer.from(`cardworkbench-sync|v1|${scope}`));
  const nodeEncrypted = Buffer.concat([nodeCipher.update(Buffer.from(JSON.stringify(input))), nodeCipher.final(), nodeCipher.getAuthTag()]);
  assert.deepEqual(await crypto.decryptSyncDocument(password, scope, { ...envelope, nonce: nodeNonce.toString('base64'), ciphertext: nodeEncrypted.toString('base64') }), input);
});

test('real crypto rejects wrong passwords, other account scopes and ciphertext tampering', async () => {
  const envelope = await crypto.encryptSyncDocument(password, scope, document(credential()), rng);
  await assert.rejects(crypto.decryptSyncDocument(newPassword, scope, envelope), /密码不正确/);
  await assert.rejects(crypto.decryptSyncDocument(password, 'b'.repeat(64), envelope), /密码不正确/);
  const corrupted = Buffer.from(envelope.ciphertext, 'base64');
  corrupted[0] ^= 1;
  await assert.rejects(crypto.decryptSyncDocument(password, scope, { ...envelope, ciphertext: corrupted.toString('base64') }), /密码不正确/);
});

test('fresh nonces, strict envelope keys/canonical Base64 and the 1 MiB cap are enforced before encryption', async () => {
  const first = await crypto.encryptSyncDocument(password, scope, document(), rng);
  const second = await crypto.encryptSyncDocument(password, scope, document(), rng, first.salt);
  assert.equal(first.salt, second.salt);
  assert.notEqual(first.nonce, second.nonce);
  assert.throws(() => crypto.validateSyncEnvelope({ ...first, extra: true }), /不兼容/);
  assert.throws(() => crypto.base64ToBytes('AB=='), /标准 Base64/);
  assert.throws(() => crypto.base64ToBytes('a==='));
  assert.throws(() => crypto.validateSyncPassword('short'), /至少 12/);
  let generated = false;
  await assert.rejects(crypto.encryptSyncDocument(password, scope, document(...Array.from({ length: 120 }, () => ({ ...credential({ secret: { ...secret, notes: 'n'.repeat(10000) } }), id: randomUUID() }))), async () => { generated = true; return new Uint8Array(16); }), /1 MiB/);
  assert.equal(generated, false);
});

test('three-way merge combines independent edits and explicitly blocks concurrent edits/deletes', () => {
  const original = credential();
  const changed = credential({ secret: { ...secret, password: '本机已编辑' } });
  const remoteChanged = credential({ secret: { ...secret, notes: '云端也编辑' } });
  const extra = { ...credential(), id: randomUUID() };
  const merged = model.mergeSyncDocuments(document(changed), document(original, extra), [baseline(original)]);
  assert.deepEqual(merged.records.find((record) => record.id === entryId), changed);
  assert.equal(merged.records.length, 2);
  assert.throws(() => model.mergeSyncDocuments(document(changed), document(remoteChanged), [baseline(original)]), model.AccountSyncConflict);
  assert.deepEqual(model.mergeSyncDocuments(document(changed), document(remoteChanged), [baseline(original)], 'remote').records, [remoteChanged]);
  const tombstone = { kind: 'credential', id: entryId, deleted: true, data: null };
  assert.deepEqual(model.mergeSyncDocuments(document(original), document(tombstone), [baseline(original)]).records, [tombstone]);
  assert.throws(() => model.mergeSyncDocuments(document(changed), document(tombstone), [baseline(original)]), model.AccountSyncConflict);
  assert.throws(() => model.mergeSyncDocuments(document(original), document(), [baseline(original)]), /缺少先前记录/);
});

test('separate local/cloud acknowledgement baselines preserve edits made after an upload before import', () => {
  const uploaded = credential({ secret: { ...secret, notes: '刚上传' } });
  const newer = credential({ secret: { ...secret, notes: '上传时又修改' } });
  const remoteOnly = { ...credential(), id: randomUUID() };
  const bases = [baseline(uploaded), { kind: remoteOnly.kind, id: remoteOnly.id, local_hash: null, remote_hash: model.syncFingerprint(remoteOnly) }];
  const merged = model.mergeSyncDocuments(document(newer), document(uploaded, remoteOnly), bases);
  assert.deepEqual(merged.records.find((record) => record.id === entryId), newer);
  assert.deepEqual(merged.records.find((record) => record.id === remoteOnly.id), remoteOnly);
});

// Native vault adapter uses real Node AES-GCM for these SQL tests. This tests
// application transactions/AAD, not AndroidKeyStore or iOS Keychain hardware.
function deviceVault() {
  const key = randomBytes(32);
  const calls = { encrypted: [], decrypted: [] };
  return {
    calls,
    newRecordId: randomUUID,
    async encryptAsync(id, text) {
      calls.encrypted.push(id);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(`device-vault-test|${id}`));
      return { keyVersion: 1, ciphertext: Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64') };
    },
    async decryptAsync(id, text, version) {
      calls.decrypted.push(id);
      assert.equal(version, 1);
      const data = Buffer.from(text, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(`device-vault-test|${id}`));
      decipher.setAuthTag(data.subarray(-16));
      return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString('utf8');
    },
  };
}
async function storageFixture(t) {
  const db = createDatabase(t);
  await databaseApi.migrateDatabase(db);
  const vault = deviceVault();
  const events = [];
  const credentials = await loadTypeScript('src/lib/credential-vault.ts', { '@credential-vault': { default: vault }, '@/lib/account-sync-events': { emitAccountSyncChange: (event) => events.push(event) } });
  const storage = await loadTypeScript('src/lib/account-sync-storage.ts', { '@credential-vault': { default: vault }, './credential-vault': credentials, './date': dates, './account-sync-model': model });
  return { db, vault, credentials, storage, events };
}

test('UUID upsert inserts absent IDs and preserves encrypted credential data and original creation time on import', async (t) => {
  const { db, credentials, storage, vault } = await storageFixture(t);
  await credentials.saveCredential(db, { id: entryId, platformName: '首次插入', categoryId: 'work', icon: 'key.fill', secret });
  assert.equal((await credentials.getCredentials(db)).length, 1);
  const snapshot = await storage.captureAccountSyncSnapshot(db);
  const imported = credential({ platformName: '来自另一台手机', createdAt: '2020-01-01T00:00:00Z' });
  const merged = document(...snapshot.document.records.filter((record) => record.kind !== 'credential'), imported);
  await storage.applyAccountSyncDocument(db, scope, 1, snapshot, merged);
  const row = await db.getFirstAsync('SELECT * FROM credential_entries WHERE id = ?', entryId);
  assert.equal(row.created_at, imported.data.createdAt);
  assert.equal(row.encrypted_payload.includes(secret.password), false);
  assert.deepEqual((await credentials.getCredential(db, entryId)).password, secret.password);
  await assert.rejects(deviceVault().decryptAsync(entryId, row.encrypted_payload, row.key_version));
  assert.ok(vault.calls.encrypted.includes(entryId));
});

test('baseline fingerprints are device-encrypted in SQLite and authenticated to their scope/kind/ID', async (t) => {
  const { db, storage } = await storageFixture(t);
  const record = credential();
  await storage.rememberAccountSyncAcknowledgement(db, scope, 1, document(record), document(record));
  const row = await db.getFirstAsync('SELECT * FROM account_sync_baselines');
  assert.equal(row.remote_hash, 'device-encrypted:v1');
  assert.equal(row.local_hash.includes(model.syncFingerprint(record)), false);
  assert.equal(row.local_hash.includes(secret.password), false);
  assert.equal((await storage.loadAccountSyncBaselines(db, scope))[0].local_hash, model.syncFingerprint(record));
  await db.runAsync('UPDATE account_sync_baselines SET id = ?', randomUUID());
  await assert.rejects(storage.loadAccountSyncBaselines(db, scope));
});

test('deletion tombstones survive sync and prevent credential resurrection', async (t) => {
  const { db, storage, credentials } = await storageFixture(t);
  await credentials.saveCredential(db, { id: entryId, platformName: '待删除', categoryId: 'work', icon: 'key.fill', secret });
  const before = await storage.captureAccountSyncSnapshot(db);
  await storage.rememberAccountSyncAcknowledgement(db, scope, 1, before.document, before.document);
  await credentials.deleteCredential(db, entryId);
  const after = await storage.captureAccountSyncSnapshot(db);
  const tombstone = after.document.records.find((record) => record.kind === 'credential');
  assert.deepEqual(tombstone, { kind: 'credential', id: entryId, deleted: true, data: null });
  const merged = model.mergeSyncDocuments(after.document, before.document, await storage.loadAccountSyncBaselines(db, scope));
  assert.equal(merged.records.find((record) => record.id === entryId).deleted, true);
  await storage.applyAccountSyncDocument(db, scope, 2, after, merged);
  assert.equal((await credentials.getCredentials(db)).length, 0);
  assert.equal((await db.getAllAsync('SELECT * FROM account_sync_deleted_credentials')).length, 1);
});

test('full task metadata uses remote identities, preserves date-only semantics and does not export fresh core defaults', async (t) => {
  const { db, storage } = await storageFixture(t);
  await db.runAsync("INSERT INTO todo_items (title, category_id, due_at, remote_id, sync_state) VALUES ('网页待办', 'work', ?, 'remote-shared', 'synced')", dates.localDueToRemote('2099-02-28'));
  const initial = await storage.captureAccountSyncSnapshot(db);
  assert.equal(initial.document.records.some((record) => record.kind === 'task'), false);
  const taskData = { notes: '完整备注', label: '生活', categoryId: 'media', isStarred: true, dueAt: '2099-02-28', coreDueAt: dates.localDueToRemote('2099-02-28'), repeatRule: 'monthly', recurrenceAnchorDueAt: '2099-01-31', recurrenceParentRemoteId: null };
  const merged = document(...initial.document.records, { kind: 'task', id: 'remote-shared', deleted: false, data: taskData });
  await storage.applyAccountSyncDocument(db, scope, 1, initial, merged);
  const row = await db.getFirstAsync("SELECT * FROM todo_items WHERE remote_id = 'remote-shared'");
  assert.equal(row.notes, taskData.notes);
  assert.equal(row.label, taskData.label);
  assert.equal(row.category_id, 'media');
  assert.equal(row.is_starred, 1);
  assert.equal(row.due_at, '2099-02-28');
  assert.equal(row.recurrence_anchor_due_at, '2099-01-31');
  assert.equal(row.repeat_rule, 'monthly');
  assert.equal(row.title, '网页待办');
  const exported = (await storage.captureAccountSyncSnapshot(db)).document.records.find((record) => record.kind === 'task');
  assert.equal(exported.id, 'remote-shared');
  assert.deepEqual(exported.data, taskData);
});

test('new local edits abort stale imports and a transaction failure rolls back all imported rows', async (t) => {
  const { db, storage, credentials } = await storageFixture(t);
  const snapshot = await storage.captureAccountSyncSnapshot(db);
  await databaseApi.insertTask(db, { title: '同步中新增', categoryId: 'work', isStarred: true, dueAt: null });
  await assert.rejects(storage.applyAccountSyncDocument(db, scope, 1, snapshot, document(...snapshot.document.records, credential())), storage.LocalAccountSyncChanged);
  assert.equal((await credentials.getCredentials(db)).length, 0);
  const fresh = await storage.captureAccountSyncSnapshot(db);
  await db.execAsync("CREATE TRIGGER fail_import BEFORE INSERT ON credential_entries BEGIN SELECT RAISE(ABORT, 'forced import rollback'); END;");
  const category = { kind: 'credential-category', id: 'custom-new', deleted: false, data: { name: '新分类', color: '#000', tint: '#fff', icon: 'key', sortOrder: 9 } };
  await assert.rejects(storage.applyAccountSyncDocument(db, scope, 1, fresh, document(...fresh.document.records, category, credential({ categoryId: 'custom-new' }))), /forced import rollback/);
  assert.equal(await db.getFirstAsync("SELECT * FROM credential_categories WHERE id='custom-new'"), null);
  assert.equal((await db.getAllAsync('SELECT * FROM credential_entries')).length, 0);
});

test('all-day raw dates survive China-to-US metadata import and later core refresh/title edits without shifting UTC', async (t) => {
  const originalZone = process.env.TZ;
  t.after(() => { if (originalZone === undefined) delete process.env.TZ; else process.env.TZ = originalZone; });
  process.env.TZ = 'Asia/Shanghai';
  const source = await storageFixture(t);
  await databaseApi.insertTask(source.db, { title: '跨时区全天待办', notes: '保留', categoryId: 'work', isStarred: true, dueAt: '2099-11-06', repeatRule: 'monthly' });
  await source.db.runAsync("UPDATE todo_items SET remote_id='shared-date', sync_state='synced'");
  const sourceSnapshot = await source.storage.captureAccountSyncSnapshot(source.db);
  const exported = sourceSnapshot.document.records.find((record) => record.kind === 'task');
  assert.equal(exported.data.coreDueAt, '2099-11-05T16:00:00.000Z');
  process.env.TZ = 'America/Los_Angeles';
  const destination = await storageFixture(t);
  await destination.db.runAsync("INSERT INTO todo_items (title, category_id, remote_id, due_at, metadata_core_due_at, sync_state) VALUES ('跨时区全天待办', 'work', 'shared-date', ?, ?, 'synced')", exported.data.coreDueAt, exported.data.coreDueAt);
  const before = await destination.storage.captureAccountSyncSnapshot(destination.db);
  await destination.storage.applyAccountSyncDocument(destination.db, scope, 1, before, sourceSnapshot.document);
  let row = await destination.db.getFirstAsync("SELECT * FROM todo_items WHERE remote_id='shared-date'");
  assert.equal(row.due_at, '2099-11-06');
  assert.equal(row.metadata_core_due_at, '2099-11-05T16:00:00.000Z');
  const coordinator = await loadTypeScript('src/lib/sync-coordinator.ts');
  const coreRequests = [];
  const remote = { id: 'shared-date', customer_id: null, customer_name: null, title: '跨时区全天待办', due_at: exported.data.coreDueAt, status: 'open', created_at: '2026-10-28', completed_at: null };
  const core = await loadTypeScript('src/lib/task-sync.ts', {
    '@/lib/date': dates, '@/lib/sync-coordinator': coordinator,
    '@/lib/workspace-api': { loadWorkspaceSession: async () => ({ baseUrl: 'https://workspace.example/' }), workspaceJson: async (path, init = {}) => {
      if (path === '/api/mobile-sync') return { scope };
      if (!init.method) return { items: [remote], nextCursor: null };
      const body = JSON.parse(init.body);
      coreRequests.push(body);
      return { task: { ...remote, title: body.title, due_at: body.dueAt } };
    } },
  });
  await core.syncWorkspaceTasks(destination.db);
  row = await destination.db.getFirstAsync("SELECT * FROM todo_items WHERE remote_id='shared-date'");
  assert.equal(row.due_at, '2099-11-06');
  await databaseApi.updateTask(destination.db, { id: row.id, title: '只改标题', notes: '保留', categoryId: 'work', isStarred: true, dueAt: '2099-11-06', repeatRule: 'monthly' });
  await core.syncWorkspaceTasks(destination.db);
  assert.equal(coreRequests[0].dueAt, '2099-11-05T16:00:00.000Z');
  assert.equal((await destination.storage.captureAccountSyncSnapshot(destination.db)).document.records.find((record) => record.kind === 'task').data.dueAt, '2099-11-06');
});

test('version-7 migration resumes after adding metadata_initialized without marking existing iPhone data', async (t) => {
  const { db, storage } = await storageFixture(t);
  await db.runAsync("INSERT INTO todo_items (title, notes, category_id, is_starred, remote_id, metadata_initialized) VALUES ('已有iPhone资料', '不能丢失的备注', 'work', 1, 'legacy-remote', 0)");
  await db.execAsync('PRAGMA user_version = 6;');
  await databaseApi.migrateDatabase(db);
  const row = await db.getFirstAsync("SELECT * FROM todo_items WHERE remote_id='legacy-remote'");
  assert.equal(row.metadata_initialized, 1);
  assert.equal(row.notes, '不能丢失的备注');
  assert.equal((await storage.captureAccountSyncSnapshot(db)).document.records.find((record) => record.kind === 'task').data.notes, row.notes);
});

test('legacy core sync checks bound account before uploading and binds every request to its captured session', async (t) => {
  const { db } = await storageFixture(t);
  await databaseApi.insertTask(db, { title: '不能发给B账号的待办', categoryId: 'work', isStarred: false, dueAt: null });
  await db.runAsync("INSERT INTO app_metadata (key, value) VALUES ('account-sync.bound-scope', ?)", scope);
  const coordinator = await loadTypeScript('src/lib/sync-coordinator.ts');
  const session = { baseUrl: 'https://workspace.example/', dispatchToken: 'dispatch-a', deviceToken: 'device-a' };
  const requests = [];
  let returnedScope = 'b'.repeat(64);
  const core = await loadTypeScript('src/lib/task-sync.ts', {
    '@/lib/date': dates, '@/lib/sync-coordinator': coordinator,
    '@/lib/workspace-api': {
      loadWorkspaceSession: async () => session,
      workspaceJson: async (path, init = {}, capturedSession) => {
        requests.push({ path, method: init.method ?? 'GET', captured: { ...capturedSession } });
        if (path === '/api/mobile-sync') return { scope: returnedScope };
        if (!init.method) { session.deviceToken = 'device-b'; return { items: [], nextCursor: null }; }
        const body = JSON.parse(init.body);
        return { task: { id: 'new-task', title: body.title, due_at: null, status: 'open' } };
      },
    },
  });
  await assert.rejects(core.syncWorkspaceTasks(db), /另一账号/);
  assert.deepEqual(requests.map((request) => request.path), ['/api/mobile-sync']);
  requests.length = 0;
  returnedScope = scope;
  await core.syncWorkspaceTasks(db);
  assert.equal(requests.find((request) => request.method === 'POST').captured.deviceToken, 'device-a');
});

test('basic-only first sync binds scope before writes even without a shared password, then blocks a different account', async (t) => {
  const { db } = await storageFixture(t);
  await databaseApi.insertTask(db, { title: '仅使用基础同步的记录', categoryId: 'work', isStarred: true, dueAt: null });
  const coordinator = await loadTypeScript('src/lib/sync-coordinator.ts');
  let owner = scope;
  const requests = [];
  const core = await loadTypeScript('src/lib/task-sync.ts', {
    '@/lib/date': dates, '@/lib/sync-coordinator': coordinator,
    '@/lib/workspace-api': {
      loadWorkspaceSession: async () => ({ baseUrl: 'https://workspace.example/', dispatchToken: 'dispatch', deviceToken: 'device' }),
      workspaceJson: async (path, init = {}) => {
        requests.push({ path, method: init.method ?? 'GET' });
        if (path === '/api/mobile-sync') return { scope: owner };
        if (!init.method) return { items: [], nextCursor: null };
        assert.equal((await db.getFirstAsync("SELECT value FROM app_metadata WHERE key='account-sync.bound-scope'")).value, scope);
        return { task: { id: 'basic-remote', title: JSON.parse(init.body).title, due_at: null, status: 'open' } };
      },
    },
  });
  await core.syncWorkspaceTasks(db);
  assert.equal((await db.getFirstAsync("SELECT value FROM app_metadata WHERE key='account-sync.bound-scope'")).value, scope);
  requests.length = 0;
  owner = 'b'.repeat(64);
  await assert.rejects(core.syncWorkspaceTasks(db), /另一账号/);
  assert.deepEqual(requests, [{ path: '/api/mobile-sync', method: 'GET' }]);
});

test('lock/session guards interrupt individual vault decrypts and prevent re-encryption writes', async (t) => {
  const { db, storage, credentials, vault } = await storageFixture(t);
  for (let index = 0; index < 2; index += 1) await credentials.saveCredential(db, { id: randomUUID(), platformName: '私密', categoryId: 'work', icon: 'key.fill', secret });
  const before = vault.calls.decrypted.length;
  const guard = async () => { if (vault.calls.decrypted.length > before) throw new Error('locked'); };
  await assert.rejects(storage.captureAccountSyncSnapshot(db, guard), /locked/);
  assert.equal(vault.calls.decrypted.length, before + 1, 'second credential is not decrypted after locking');
  const snapshot = await storage.captureAccountSyncSnapshot(db);
  const encryptedBefore = vault.calls.encrypted.length;
  await assert.rejects(storage.applyAccountSyncDocument(db, scope, 1, snapshot, document(...snapshot.document.records, { ...credential(), id: randomUUID() }), async () => { if (vault.calls.encrypted.length > encryptedBefore) throw new Error('locked'); }), /locked/);
  assert.equal((await db.getAllAsync('SELECT * FROM credential_entries')).length, 2);
});

test('two different next-occurrence IDs for the same parent report a clear conflict without deleting either', async (t) => {
  const { db, storage } = await storageFixture(t);
  for (const id of ['parent', 'child-a', 'child-b']) await db.runAsync("INSERT INTO todo_items (title, category_id, remote_id) VALUES (?, 'work', ?)", id, id);
  const snapshot = await storage.captureAccountSyncSnapshot(db);
  const data = { notes: null, label: null, categoryId: 'work', isStarred: false, dueAt: null, repeatRule: 'none', recurrenceAnchorDueAt: null, recurrenceParentRemoteId: 'parent' };
  await assert.rejects(storage.applyAccountSyncDocument(db, scope, 1, snapshot, document(...snapshot.document.records, ...['child-a', 'child-b'].map((id) => ({ kind: 'task', id, deleted: false, data })))), /两台手机生成了不同的下一期/);
  assert.equal((await db.getAllAsync('SELECT * FROM todo_items')).length, 3);
});

// Narrow transport/lifecycle fixtures exercise actual controller control flow;
// encryption correctness above is tested with real algorithms, independently.
async function controllerFixture(t, patch = {}) {
  const state = {
    session: { baseUrl: 'https://workspace.example/', dispatchToken: 'dispatch-a', deviceToken: 'device-a' },
    unlocked: true, requests: [], stored: new Map(), imports: 0, captures: 0, encrypts: 0,
    bound: null, knownRevision: 0, cloud: { scope, revision: 0, envelope: null, updatedAt: null },
    remoteDocument: document(), localDocument: document(credential()), putStatuses: [], events: [],
    ...patch,
  };
  const platform = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
  state.platform = platform;
  state.stored.set(`account-sync.password.${scope}`, JSON.stringify({ current: password }));
  const envelopePasswords = new Map();
  let nonceCounter = 0;
  const mockCrypto = {
    ...crypto,
    async encryptSyncDocument(pw, account, doc) {
      state.encrypts += 1;
      await state.onEncrypt?.();
      const envelope = { version: 1, kdf: 'pbkdf2-sha256', iterations: 310000, salt: Buffer.alloc(16).toString('base64'), nonce: Buffer.alloc(12, ++nonceCounter).toString('base64'), ciphertext: Buffer.alloc(16, nonceCounter).toString('base64') };
      envelopePasswords.set(envelope.ciphertext, pw);
      state.uploadedDocument = doc;
      return envelope;
    },
    async decryptSyncDocument(pw, account, envelope) {
      await state.onDecrypt?.();
      if (pw !== (envelopePasswords.get(envelope.ciphertext) ?? password)) throw new Error('同步密码不正确');
      return state.remoteDocument;
    },
  };
  state.makeEnvelope = async (pw = password) => mockCrypto.encryptSyncDocument(pw, scope, state.remoteDocument);
  const actualFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    state.requests.push({ url: String(url), ...init });
    if (init.method === 'PUT') {
      const code = state.putStatuses.shift() ?? 200;
      if (code !== 200) return new Response('{}', { status: code });
      const body = JSON.parse(init.body);
      state.cloud = { scope, revision: body.expectedRevision + 1, envelope: body.envelope, updatedAt: '2026-10-28T12:00:00Z' };
      state.remoteDocument = state.uploadedDocument;
      if (state.losePutResponse) { state.losePutResponse = false; throw new Error('response lost'); }
      return Response.json({ revision: state.cloud.revision, updatedAt: state.cloud.updatedAt });
    }
    if (state.getStatus) return new Response('{}', { status: state.getStatus });
    return Response.json(state.cloud);
  };
  t.after(() => { globalThis.fetch = actualFetch; });
  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const api = await loadTypeScript('src/lib/account-sync.ts', {
    'expo-crypto': { getRandomBytesAsync: rng },
    'expo-secure-store': { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', getItemAsync: async (key) => state.stored.get(key) ?? null, setItemAsync: async (key, value) => { state.stored.set(key, value); }, deleteItemAsync: async (key) => { state.stored.delete(key); } },
    'react-native': { AppState: platform },
    './account-sync-crypto': mockCrypto, './account-sync-model': model,
    './account-sync-events': { emitAccountSyncChange: (event) => state.events.push(event) },
    './face-id-session': { loadValidFaceIdSession: async () => state.unlocked ? Date.now() + 60000 : null },
    './task-sync': { syncWorkspaceTasks: async () => { await state.onCore?.(); } },
    './workspace-api': { WorkspaceApiError: ApiError, loadWorkspaceSession: async () => state.session ? { ...state.session } : null,
      workspaceAuthHeaders: (session) => { state.onHeaders?.(); return { 'OAI-Sites-Authorization': `Bearer ${session.dispatchToken}`, 'X-Workspace-Device-Token': session.deviceToken }; } },
    './account-sync-storage': {
      LocalAccountSyncChanged: class LocalAccountSyncChanged extends Error {},
      getAccountSyncBoundScope: async () => state.bound,
      getAccountSyncKnownRevision: async () => state.knownRevision,
      loadAccountSyncBaselines: async () => [],
      captureAccountSyncSnapshot: async (db, guard) => { await guard(); state.captures += 1; return { revision: 0, document: state.localDocument, taskRows: [] }; },
      rememberAccountSyncAcknowledgement: async (db, owner, revision, local, merged, guard) => { await guard(); },
      applyAccountSyncDocument: async (db, owner, revision, snapshot, merged, guard) => { await guard(); state.imports += 1; },
    },
  });
  return { state, api, db: {} };
}

test('captured identity binds PUT auth even if pairing changes immediately after the final guard', async (t) => {
  const { state, api, db } = await controllerFixture(t);
  let headers = 0;
  state.onHeaders = () => { if (++headers === 2) state.session = { baseUrl: 'https://other.example/', dispatchToken: 'dispatch-b', deviceToken: 'device-b' }; };
  await assert.rejects(api.syncAccountData(db), /凭证已变化/);
  const put = state.requests.find((request) => request.method === 'PUT');
  assert.ok(put);
  assert.equal(put.url, 'https://workspace.example/api/mobile-sync');
  assert.equal(put.headers['X-Workspace-Device-Token'], 'device-a');
  assert.equal(put.headers['OAI-Sites-Authorization'], 'Bearer dispatch-a');
  assert.equal(state.imports, 0);
});

for (const code of [401, 404, 500]) test(`GET ${code} is an error, never an empty vault or an upload`, async (t) => {
  const { state, api, db } = await controllerFixture(t, { getStatus: code });
  await assert.rejects(api.syncAccountData(db));
  assert.equal(state.requests.some((request) => request.method === 'PUT'), false);
  assert.equal(state.captures, 0);
});

test('wrong password, another bound account and cloud rollback never overwrite cloud/local data', async (t) => {
  const fixture = await controllerFixture(t);
  fixture.state.cloud = { scope, revision: 1, envelope: await fixture.state.makeEnvelope(newPassword), updatedAt: '2026-10-28' };
  await assert.rejects(fixture.api.syncAccountData(fixture.db), /密码不正确/);
  assert.equal(fixture.state.imports, 0);
  assert.equal(fixture.state.requests.some((request) => request.method === 'PUT'), false);
  fixture.state.bound = 'b'.repeat(64);
  await assert.rejects(fixture.api.syncAccountData(fixture.db), /另一账号/);
  fixture.state.bound = null;
  fixture.state.knownRevision = 3;
  await assert.rejects(fixture.api.syncAccountData(fixture.db), /回退/);
});

test('configuring a wrong shared password preserves the previously saved password and never resets cloud data', async (t) => {
  const { state, api, db } = await controllerFixture(t);
  state.cloud = { scope, revision: 1, envelope: await state.makeEnvelope(), updatedAt: '2026-10-28' };
  const before = state.stored.get(`account-sync.password.${scope}`);
  await assert.rejects(api.configureAccountSyncPassword(db, newPassword), /密码不正确/);
  assert.equal(state.stored.get(`account-sync.password.${scope}`), before);
  assert.equal(state.requests.some((request) => request.method === 'PUT'), false);
  assert.equal(state.imports, 0);
});

test('unpaired or locked devices do not request cloud data or read the credential snapshot', async (t) => {
  const { state, api, db } = await controllerFixture(t, { session: null });
  await api.syncAccountData(db);
  assert.equal(api.getAccountSyncStatus().phase, 'unpaired');
  assert.equal(state.requests.length, 0);
  state.session = { baseUrl: 'https://workspace.example/', dispatchToken: 'dispatch-a', deviceToken: 'device-a' };
  state.unlocked = false;
  await api.syncAccountData(db);
  assert.equal(api.getAccountSyncStatus().phase, 'paused');
  assert.equal(state.requests.length, 0);
  assert.equal(state.captures, 0);
});

test('CAS conflict retries at most three times and ordinary network failures are not blindly retried', async (t) => {
  const { state, api, db } = await controllerFixture(t, { putStatuses: [409, 409, 409] });
  await assert.rejects(api.syncAccountData(db), /正在修改资料/);
  assert.equal(state.requests.filter((request) => request.method === 'PUT').length, 3);
  assert.equal(state.imports, 0);
});

test('locking during cloud decryption stops before any local credential snapshot/decrypt', async (t) => {
  const { state, api, db } = await controllerFixture(t);
  state.cloud = { scope, revision: 1, envelope: await state.makeEnvelope(), updatedAt: '2026-10-28' };
  state.onDecrypt = async () => { state.unlocked = false; };
  await assert.rejects(api.syncAccountData(db), /解锁/);
  assert.equal(state.captures, 0);
  assert.equal(state.imports, 0);
});

test('forgetting a pending rotation during PBKDF2 cannot restore the forgotten password or upload with it', async (t) => {
  const { state, api, db } = await controllerFixture(t);
  state.stored.set(`account-sync.password.${scope}`, JSON.stringify({ current: password, pending: newPassword }));
  state.cloud = { scope, revision: 1, envelope: await state.makeEnvelope(newPassword), updatedAt: '2026-10-28' };
  let entered;
  let release;
  const entering = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  state.onDecrypt = async () => { entered(); await gate; };
  const running = api.syncAccountData(db);
  const failure = assert.rejects(running, /密码设置已变化/);
  await entering;
  await api.forgetAccountSyncPassword();
  release();
  await failure;
  assert.equal(state.stored.has(`account-sync.password.${scope}`), false);
  assert.equal(state.requests.some((request) => request.method === 'PUT'), false);
  assert.equal(state.captures, 0);
  assert.equal(api.getAccountSyncStatus().configured, false);
});

test('lost rotation response is recovered using staged password on the next authenticated GET', async (t) => {
  const { state, api, db } = await controllerFixture(t);
  state.cloud = { scope, revision: 1, envelope: await state.makeEnvelope(), updatedAt: '2026-10-28' };
  state.remoteDocument = state.localDocument;
  state.losePutResponse = true;
  await assert.rejects(api.changeAccountSyncPassword(db, newPassword), /网络中断/);
  const staged = JSON.parse(state.stored.get(`account-sync.password.${scope}`));
  assert.equal(staged.current, password);
  assert.equal(staged.pending, newPassword);
  await api.syncAccountData(db);
  assert.deepEqual(JSON.parse(state.stored.get(`account-sync.password.${scope}`)), { current: newPassword });
  assert.equal(api.getAccountSyncStatus().phase, 'ready');
});
