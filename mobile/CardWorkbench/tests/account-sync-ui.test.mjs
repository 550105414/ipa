import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTypeScript } from './helpers/load-typescript.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
const element = (type, props) => ({ type, props });
const text = (node) => Array.isArray(node) ? node.map(text).join(' ')
  : typeof node === 'string' || typeof node === 'number' ? String(node) : text(node?.props?.children ?? []);
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of Array.isArray(node) ? node : Object.values(node.props ?? {})) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}
async function eventually(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail('Timed out waiting for actual screen state');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
const entry = (platformName) => ({ id: 'entry-1', platformName, account: 'synthetic-account', password: 'synthetic-secret',
  categoryId: 'work', categoryName: '工作', categoryColor: '#000', categoryTint: '#fff', icon: 'key.fill',
  email: '', nickname: '', website: '', notes: '', tags: [], createdAt: '2026-01-01', updatedAt: '2026-10-29' });

// Narrow native/hook adapters execute the real UI handlers, not a duplicate of
// their refresh logic. No real device records, account keys or passwords load.
async function screenFixture(path, patch = {}) {
  const state = { vaultCalls: [], refreshCalls: 0, listeners: new Set(), appListeners: new Set(), grants: new Set(), alerts: [],
    status: { phase: 'partial', configured: true, scope: 'a'.repeat(64), syncScope: 'credentials-only', message: '密码库已同步', lastSyncedAt: null, lastVaultSyncedAt: '2026-10-29T00:00:00Z' }, ...patch };
  const database = {};
  const slots = [];
  let cursor = 0;
  let focusEffect, focusCleanup;
  const effects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, (value) => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useEffect(callback) { effects.push(callback); },
    useSyncExternalStore: () => state.status,
  };
  const vaultSync = async (db, resolution, conflictContext) => { state.vaultCalls.push({ db, resolution, conflictContext }); await state.synchronize?.(); };
  const components = Object.fromEntries(['Pressable', 'Text', 'View', 'ScrollView', 'RefreshControl', 'TextInput', 'Switch'].map((name) => [name, name]));
  const module = await loadTypeScript(path, {
    react,
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': { ...components, StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
      Alert: { alert: (...args) => { state.alerts.push(args); } },
      AppState: { addEventListener: (_, callback) => { state.appListeners.add(callback); return { remove: () => state.appListeners.delete(callback) }; } } },
    'expo-router': { useRouter: () => ({ push() {}, replace() {} }), useLocalSearchParams: () => ({ id: 'entry-1' }), useFocusEffect: (callback) => { focusEffect = callback; } },
    'expo-sqlite': { useSQLiteContext: () => database },
    'expo-clipboard': { setStringAsync: async () => undefined },
    '@/components/symbol-icon': { SymbolIcon: 'SymbolIcon' },
    '@/components/account-sync-card': { AccountSyncCard: 'AccountSyncCard' },
    '@/lib/credential-vault': { getCredentials: () => state.readEntries?.() ?? Promise.resolve([entry('本机平台')]), getCredentialCategories: async () => [], getCredential: () => state.readEntry?.() ?? Promise.resolve(entry('本机平台')), deleteCredential: async () => undefined },
    '@/lib/account-sync-events': { subscribeAccountSyncChanges: (callback) => { state.listeners.add(callback); return () => state.listeners.delete(callback); } },
    '@/lib/account-sync': { syncCredentialVault: vaultSync, syncAccountData: async (...args) => { state.fullCalls ??= []; state.fullCalls.push(args); },
      getAccountSyncStatus: () => state.status, subscribeAccountSyncStatus: () => () => {}, configureAccountSyncPassword: async () => {}, changeAccountSyncPassword: async () => {}, forgetAccountSyncPassword: async () => {} },
    '@/lib/face-id-session': { subscribeToFaceIdSessionGranted: (callback) => { state.grants.add(callback); return () => state.grants.delete(callback); } },
    '@/providers/todo-provider': { useTodos: () => ({ refresh: async () => { state.refreshCalls += 1; await state.refresh?.(); } }) },
    '@/theme/colors': { colors: new Proxy({}, { get: () => '#000000' }), layout: { horizontalPadding: 16 } },
  });
  return {
    state, database, module,
    render(component = module.default) { cursor = 0; return component(); },
    focus() { focusCleanup = focusEffect(); },
    blur() { focusCleanup?.(); focusCleanup = undefined; },
    emit(event) { for (const callback of state.listeners) callback(event); },
    mountEffects() { const cleanup = effects.map((effect) => effect()); return () => { for (const dispose of cleanup) dispose?.(); }; },
  };
}

test('global bridge starts vault independently of a never-finishing widget/task refresh and never loops on imported', async () => {
  const never = new Promise(() => {});
  const fixture = await screenFixture('src/components/account-sync-card.tsx', { refresh: () => never });
  fixture.render(fixture.module.AccountSyncBridge);
  const dispose = fixture.mountEffects();
  assert.equal(fixture.state.vaultCalls.length, 1);
  fixture.emit('local-changed');
  fixture.emit('settings-changed');
  assert.equal(fixture.state.vaultCalls.length, 3);
  assert.equal(fixture.state.refreshCalls, 2);
  fixture.emit('imported');
  assert.equal(fixture.state.vaultCalls.length, 3);
  for (const callback of fixture.state.appListeners) callback('active');
  for (const callback of fixture.state.grants) callback();
  assert.equal(fixture.state.vaultCalls.length, 5);
  dispose();
  assert.equal(fixture.state.listeners.size, 0);
  assert.equal(fixture.state.appListeners.size, 0);
  assert.equal(fixture.state.grants.size, 0);
});

test('password list focus shows local records before cloud completion and pull-refresh calls only vault', async () => {
  const cloud = deferred();
  const fixture = await screenFixture('src/app/passwords.tsx', { synchronize: () => cloud.promise });
  fixture.render(); fixture.focus();
  await eventually(() => text(fixture.render()).includes('本机平台'));
  assert.equal(fixture.state.vaultCalls.length, 1, 'focus receives another device update even without an AppState transition');
  const control = find(fixture.render(), (node) => node.type === 'RefreshControl');
  control.props.onRefresh();
  assert.equal(fixture.state.vaultCalls.length, 2);
  assert.equal(fixture.state.refreshCalls, 0, 'password refresh never waits on TodoProvider/widget');
  assert.match(text(fixture.render()), /本机平台/);
  cloud.resolve();
  await eventually(() => find(fixture.render(), (node) => node.type === 'RefreshControl').props.refreshing === false);
  fixture.blur();
});

test('password list import supersedes stale decrypt reads and blurred reads cannot repopulate the screen', async () => {
  const old = deferred(), newer = deferred(), late = deferred();
  const queue = [old, newer, late];
  const fixture = await screenFixture('src/app/passwords.tsx', { readEntries: () => queue.shift().promise });
  fixture.render(); fixture.focus();
  fixture.emit('imported');
  newer.resolve([entry('新导入的平台')]);
  await eventually(() => text(fixture.render()).includes('新导入的平台'));
  old.resolve([entry('旧读取不得回写')]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(text(fixture.render()), /旧读取不得回写/);
  fixture.emit('local-changed');
  fixture.blur();
  late.resolve([entry('离开后不得回写')]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(text(fixture.render()), /新导入的平台|离开后不得回写/);
  assert.equal(fixture.state.listeners.size, 0);
});

test('open credential detail refreshes imports/deletions and rejects old or blurred async results', async () => {
  const old = deferred(), newer = deferred(), deletion = deferred(), late = deferred();
  const queue = [old, newer, deletion, late];
  const fixture = await screenFixture('src/app/credential/[id].tsx', { readEntry: () => queue.shift().promise });
  fixture.render(); fixture.focus();
  assert.equal(fixture.state.vaultCalls.length, 1);
  fixture.emit('imported');
  newer.resolve(entry('远端更新后的详情'));
  await eventually(() => text(fixture.render()).includes('远端更新后的详情'));
  old.resolve(entry('旧详情不得回写'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(text(fixture.render()), /旧详情不得回写/);
  fixture.emit('local-changed'); deletion.resolve(null);
  await eventually(() => text(fixture.render()).includes('已删除或不存在'));
  fixture.emit('imported'); fixture.blur(); late.resolve(entry('离开后不得解密显示'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(text(fixture.render()), /离开后不得解密显示/);
  assert.equal(fixture.state.listeners.size, 0);
});

test('credential conflict choice stays credential-only and successful button does not wait on widget refresh', async () => {
  const conflictContext = Object.freeze({ scope: 'a'.repeat(64), cloudRevision: 2, mode: 'credentials-only', conflictKeys: Object.freeze(['credential:entry-1']), localFingerprint: 'synthetic-memory-only' });
  const fixture = await screenFixture('src/app/sync.tsx', { status: { phase: 'conflict', configured: true, syncScope: 'credentials-only', conflictContext, message: '密码冲突', scope: null, lastVaultSyncedAt: null, lastSyncedAt: null }, refresh: () => new Promise(() => {}) });
  const choose = find(fixture.render(), (node) => node.type === 'Pressable' && text(node) === '冲突记录采用本机版本');
  choose.props.onPress();
  const [, description, buttons] = fixture.state.alerts.at(-1);
  assert.match(description, /仅处理密码库和密码分类，不影响待办/);
  fixture.state.status = { ...fixture.state.status, syncScope: 'all', conflictContext: null };
  buttons.find((button) => button.text === '确认采用').onPress();
  await eventually(() => fixture.state.refreshCalls === 1);
  assert.deepEqual(fixture.state.vaultCalls.map(({ resolution }) => resolution), ['local']);
  assert.equal(fixture.state.vaultCalls[0].conflictContext, conflictContext, 'confirmation uses the context and scope displayed when the Alert opened');
  assert.equal(fixture.state.fullCalls?.length ?? 0, 0);
  await eventually(() => !text(fixture.render()).includes('处理中'));
});

test('a full-sync error card still shows separately proven password-vault success time', async () => {
  const fixture = await screenFixture('src/components/account-sync-card.tsx', { status: { phase: 'error', configured: true, syncScope: 'all', message: '完整待办同步失败', lastVaultSyncedAt: '2026-10-29T00:00:00Z', lastSyncedAt: null } });
  const output = text(fixture.render(fixture.module.AccountSyncCard));
  assert.match(output, /完整待办同步失败/);
  assert.match(output, /密码库最近成功/);
  assert.doesNotMatch(output, /完整资料最近成功/);
});
