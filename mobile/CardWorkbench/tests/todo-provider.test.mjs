import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTypeScript } from './helpers/load-typescript.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const task = (overrides = {}) => ({ id: 1, title: '本机待办', notes: null, label: null,
  categoryId: 'inbox', categoryName: '收集箱', categoryColor: '#5D8FCB',
  categoryTint: '#EAF1FB', categoryIcon: 'tray', isStarred: true,
  dueAt: '2026-11-06', completedAt: null, createdAt: '2026-10-07',
  updatedAt: '2026-10-07', repeatRule: 'none', ...overrides });
const cloudResult = { paired: true, pulled: 0, pushed: 0, remoteCount: 1 };

// A minimal hook adapter executes the actual provider's async callbacks and
// state transitions without loading React Native into Node or copying its logic.
async function providerHarness({ readTasks = async () => [task()], synchronize = async () => cloudResult,
  widget = async () => ({ total: 1, updatedAt: '2026-10-07T02:00:00.000Z' }),
  notifications = async () => undefined } = {}) {
  const slots = [];
  let cursor = 0;
  const react = {
    createContext: () => ({}),
    use: (context) => context.value,
    useCallback: (callback) => callback,
    useEffect: () => undefined,
    useMemo: (factory) => factory(),
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
  };
  const provider = await loadTypeScript('src/providers/todo-provider.tsx', {
    react,
    'react/jsx-runtime': { jsx: (_, props) => props },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-sqlite': { useSQLiteContext: () => ({}) },
    '@/lib/database': { getCategories: async () => [], getTasks: readTasks },
    '@/lib/date': { formatDueDate: (value) => value },
    '@/lib/task-sync': { syncWorkspaceTasks: synchronize },
    '@/lib/todo-notifications': { syncTaskNotifications: notifications },
    '@/widgets/todo-widget': { syncTodoWidget: widget },
  });
  return {
    render() {
      cursor = 0;
      return provider.TodoProvider({ children: null }).value;
    },
  };
}

async function eventually(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail('Timed out waiting for the provider state');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test('existing SQLite tasks are visible before a delayed cloud request completes', async () => {
  const cloud = deferred();
  const cloudStarted = deferred();
  const harness = await providerHarness({ synchronize: () => {
    cloudStarted.resolve();
    return cloud.promise;
  } });
  const operation = harness.render().refresh();
  await cloudStarted.promise;
  const local = harness.render();
  assert.equal(local.isLoading, false);
  assert.equal(local.tasks[0].title, '本机待办');
  assert.equal(local.errorMessage, null);
  assert.equal(local.syncStatus, 'syncing');
  cloud.resolve(cloudResult);
  await operation;
  assert.equal(harness.render().syncStatus, 'ready');
});

test('WidgetKit latency does not hide the local task list behind loading', async () => {
  const widget = deferred();
  const harness = await providerHarness({ widget: () => widget.promise });
  const operation = harness.render().refresh();
  await eventually(() => harness.render().widgetStatus === 'updating');
  assert.equal(harness.render().isLoading, false);
  assert.equal(harness.render().tasks.length, 1);
  widget.resolve({ total: 1, updatedAt: '2026-10-07T03:00:00.000Z' });
  await operation;
  assert.equal(harness.render().widgetStatus, 'updated');
  assert.equal(harness.render().widgetUpdatedAt, '2026-10-07T03:00:00.000Z');
});

test('offline refresh and a cloud-required failure retain the editable local screen', async () => {
  const harness = await providerHarness({ synchronize: async () => { throw new Error('network offline'); } });
  await harness.render().refresh();
  assert.equal(harness.render().syncStatus, 'offline');
  assert.equal(harness.render().errorMessage, null);
  assert.equal(harness.render().tasks.length, 1);
  await assert.rejects(harness.render().refresh({ requireCloud: true }), /network offline/);
  assert.equal(harness.render().errorMessage, null);
  assert.equal(harness.render().isLoading, false);
  assert.equal(harness.render().tasks[0].title, '本机待办');
});

test('a stale generation cannot replace newer local task data or refresh status', async () => {
  const firstRead = deferred();
  let reads = 0;
  const harness = await providerHarness({ readTasks: () => {
    if (reads++ === 0) return firstRead.promise;
    return Promise.resolve([task({ title: '最新待办' })]);
  } });
  const old = harness.render().refresh();
  const latest = harness.render().refresh();
  await latest;
  firstRead.resolve([task({ title: '已过期快照' })]);
  await old;
  assert.equal(harness.render().tasks[0].title, '最新待办');
  assert.equal(harness.render().syncStatus, 'ready');
});

test('widget write and reminder scheduling errors remain visible independently of cloud success', async () => {
  const harness = await providerHarness({
    widget: async () => { throw new Error('共享容器不可用'); },
    notifications: async () => { throw new Error('提醒容量不足'); },
  });
  await harness.render().refresh();
  await eventually(() => harness.render().reminderError !== null);
  const value = harness.render();
  assert.equal(value.widgetStatus, 'error');
  assert.equal(value.widgetError, '共享容器不可用');
  assert.equal(value.reminderError, '提醒容量不足');
  assert.equal(value.syncStatus, 'widget-error');
  assert.equal(value.errorMessage, null);
  assert.equal(value.isLoading, false);
});
