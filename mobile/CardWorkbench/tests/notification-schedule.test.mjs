import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
}
const asModuleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const dateUrl = asModuleUrl(compile(await readFile(new URL('../src/lib/date.ts', import.meta.url), 'utf8')));
const helperSource = compile(await readFile(new URL('../src/lib/notification-schedule.ts', import.meta.url), 'utf8'))
  .replace(/from ['"]\.\/date['"]/, `from ${JSON.stringify(dateUrl)}`);
const helperUrl = asModuleUrl(helperSource);
const helper = await import(helperUrl);
const now = Date.parse('2026-10-07T10:00:00Z');
const task = (id, patch = {}) => ({
  id, title: `任务 ${id}`, notes: null, dueAt: '2026-10-08T11:00:00Z', completedAt: null, ...patch,
});

function adapterFixture() {
  const pending = new Map();
  const events = [];
  const adapter = {
    canSchedule: async () => true,
    getScheduled: async () => [...pending.values()],
    schedule: async (reminder) => {
      events.push(['schedule', reminder.identifier, reminder.title]);
      pending.set(reminder.identifier, { ...reminder, source: helper.TASK_NOTIFICATION_SOURCE });
    },
    cancel: async (identifier) => { events.push(['cancel', identifier]); pending.delete(identifier); },
  };
  return { pending, events, adapter, scheduler: helper.createTaskReminderScheduler(adapter, () => now) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('date-only reminder is local 09:00, while timestamps preserve their exact instant', () => {
  const script = `const h = await import(${JSON.stringify(helperUrl)}); console.log(JSON.stringify([
    h.getTaskReminderDate('2026-11-06')?.toISOString(),
    h.getTaskReminderDate('2026-11-06T15:30:00+08:00')?.toISOString(),
    h.getTaskReminderDate('2026-02-30'), h.getTaskReminderDate(null),
  ]));`;
  for (const [zone, expected] of [
    ['Asia/Shanghai', '2026-11-06T01:00:00.000Z'],
    ['America/New_York', '2026-11-06T14:00:00.000Z'],
  ]) {
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: zone }, encoding: 'utf8',
    })), [expected, '2026-11-06T07:30:00.000Z', null, null]);
  }
});

test('plan excludes invalid, undated, completed and already-due tasks, and uses notes in the card', () => {
  const plan = helper.buildTaskReminderPlan([
    task(1, { dueAt: null }), task(2, { completedAt: '2026-10-07' }),
    task(3, { dueAt: 'invalid' }), task(4, { dueAt: '2026-10-07T10:00:00Z' }),
    task(5, { notes: '  按约定还款  ' }),
  ], now);
  assert.equal(plan.requestedCount, 1);
  assert.equal(plan.reminders[0].title, '任务 5');
  assert.equal(plan.reminders[0].body, '按约定还款');
  assert.equal(plan.reminders[0].identifier, 'cardworkbench-todo-5');
});

test('only the nearest 32 reminders are pre-scheduled and extra capacity is visible', () => {
  const tasks = Array.from({ length: 40 }, (_, index) => task(index + 1, {
    dueAt: new Date(now + (40 - index) * 60_000).toISOString(),
  }));
  const plan = helper.buildTaskReminderPlan(tasks, now);
  assert.equal(plan.requestedCount, 40);
  assert.equal(plan.deferredCount, 8);
  assert.equal(plan.reminders.length, 32);
  assert.equal(plan.reminders[0].taskId, '40');
  assert.equal(plan.reminders[31].taskId, '9');
});

test('unchanged reminders are not cancelled or rescheduled; edits replace the same identifier', async () => {
  const fixture = adapterFixture();
  await fixture.scheduler.sync([task(1)]);
  await fixture.scheduler.sync([task(1)]);
  assert.equal(fixture.events.length, 1);
  await fixture.scheduler.sync([task(1, { title: '改后的待办', dueAt: '2026-10-09T11:30:00Z' })]);
  assert.deepEqual(fixture.events.map((event) => event[0]), ['schedule', 'schedule']);
  assert.equal(fixture.pending.size, 1);
  assert.equal(fixture.pending.get('cardworkbench-todo-1').title, '改后的待办');
});

test('completion or removing the date cancels that task, preserving tests and other apps sources', async () => {
  const fixture = adapterFixture();
  fixture.pending.set('test', { identifier: 'test', source: 'cardworkbench-reminder-test' });
  fixture.pending.set('other', { identifier: 'other', source: 'other' });
  await fixture.scheduler.sync([task(1), task(2)]);
  await fixture.scheduler.sync([task(1, { completedAt: '2026-10-07' }), task(2, { dueAt: null })]);
  assert.deepEqual([...fixture.pending.keys()], ['test', 'other']);
});

test('legacy random identifiers are migrated only after their replacement succeeds', async () => {
  const fixture = adapterFixture();
  fixture.pending.set('old-random', { identifier: 'old-random', source: helper.TASK_NOTIFICATION_SOURCE, taskId: '1' });
  await fixture.scheduler.sync([task(1)]);
  assert.deepEqual(fixture.events.map((event) => event[0]), ['schedule', 'cancel']);
  assert.deepEqual([...fixture.pending.keys()], ['cardworkbench-todo-1']);
});

test('a failed replacement preserves the existing reminder and the scheduler can be retried', async () => {
  const fixture = adapterFixture();
  await fixture.scheduler.sync([task(1)]);
  const original = fixture.pending.get('cardworkbench-todo-1');
  const schedule = fixture.adapter.schedule;
  fixture.adapter.schedule = async () => { throw new Error('native scheduling failed'); };
  await assert.rejects(fixture.scheduler.sync([task(1, { title: '新标题' })]), /native scheduling failed/);
  assert.equal(fixture.pending.get('cardworkbench-todo-1'), original);
  assert.equal(fixture.events.some((event) => event[0] === 'cancel'), false);
  fixture.adapter.schedule = schedule;
  await fixture.scheduler.sync([task(1, { title: '新标题' })]);
  assert.equal(fixture.pending.get('cardworkbench-todo-1').title, '新标题');
});

test('latest edit wins while the native list operation is pending', async () => {
  const fixture = adapterFixture();
  const gate = deferred();
  fixture.adapter.getScheduled = async () => { await gate.promise; return [...fixture.pending.values()]; };
  const first = fixture.scheduler.sync([task(1, { title: '旧标题' })]);
  const second = fixture.scheduler.sync([task(1, { title: '最新标题' })]);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(fixture.pending.get('cardworkbench-todo-1').title, '最新标题');
  assert.deepEqual(fixture.events.map((event) => event[2]), ['最新标题']);
});

test('completion during a native scheduling operation still removes the stale pending request', async () => {
  const fixture = adapterFixture();
  const entered = deferred();
  const gate = deferred();
  const schedule = fixture.adapter.schedule;
  fixture.adapter.schedule = async (reminder) => { entered.resolve(); await gate.promise; await schedule(reminder); };
  const first = fixture.scheduler.sync([task(1)]);
  await entered.promise;
  const latest = fixture.scheduler.sync([task(1, { completedAt: '2026-10-07' })]);
  gate.resolve();
  await Promise.all([first, latest]);
  assert.equal(fixture.pending.size, 0);
  assert.deepEqual(fixture.events.map((event) => event[0]), ['schedule', 'cancel']);
});

test('a failed older pass does not discard the latest edit', async () => {
  const fixture = adapterFixture();
  const entered = deferred();
  const gate = deferred();
  const schedule = fixture.adapter.schedule;
  let firstPass = true;
  fixture.adapter.schedule = async (reminder) => {
    if (firstPass) { firstPass = false; entered.resolve(); await gate.promise; throw new Error('old pass failed'); }
    await schedule(reminder);
  };
  const first = fixture.scheduler.sync([task(1)]);
  await entered.promise;
  const latest = fixture.scheduler.sync([task(1, { title: '最新编辑' })]);
  gate.resolve();
  await Promise.all([first, latest]);
  assert.equal(fixture.pending.get('cardworkbench-todo-1').title, '最新编辑');
});

test('revoked notification permission clears only owned task reminders', async () => {
  const fixture = adapterFixture();
  await fixture.scheduler.sync([task(1)]);
  fixture.pending.set('test', { identifier: 'test', source: 'cardworkbench-reminder-test' });
  fixture.adapter.canSchedule = async () => false;
  await fixture.scheduler.sync([task(1)]);
  assert.deepEqual([...fixture.pending.keys()], ['test']);
});

test('queued input is copied so later array/object mutation does not alter the saved task snapshot', async () => {
  const fixture = adapterFixture();
  const gate = deferred();
  fixture.adapter.canSchedule = async () => { await gate.promise; return true; };
  const input = [task(1)];
  const running = fixture.scheduler.sync(input);
  input[0].title = '未提交的修改';
  input.push(task(2));
  gate.resolve();
  await running;
  assert.equal(fixture.pending.size, 1);
  assert.equal(fixture.pending.get('cardworkbench-todo-1').title, '任务 1');
});

test('edits arriving in completion microtasks cannot join an already-finished worker', async () => {
  // Try every adjacent microtask boundary around the empty first pass. In particular,
  // depth 2 arrives between the async worker resolving and a chained .finally running.
  for (let depth = 1; depth <= 8; depth += 1) {
    const fixture = adapterFixture();
    const latestCalled = deferred();
    let latest;
    let firstList = true;
    fixture.adapter.getScheduled = async () => {
      if (firstList) {
        firstList = false;
        const enqueue = (remaining) => queueMicrotask(() => {
          if (remaining > 1) enqueue(remaining - 1);
          else { latest = fixture.scheduler.sync([task(1)]); latestCalled.resolve(); }
        });
        enqueue(depth);
      }
      return [...fixture.pending.values()];
    };
    const first = fixture.scheduler.sync([]);
    await latestCalled.promise;
    await Promise.all([first, latest]);
    assert.equal(fixture.pending.size, 1, `completion microtask depth ${depth}`);
  }
});

const notificationSource = compile(await readFile(new URL('../src/lib/todo-notifications.ts', import.meta.url), 'utf8'));
let testInstance = 0;
async function notificationApiFixture(initialPermission) {
  const state = { permission: initialPermission, requested: [], pending: new Map(), handler: null };
  const fixtureKey = `__todoNotificationFixture${testInstance++}`;
  globalThis[fixtureKey] = state;
  const nativeUrl = asModuleUrl(`
    const state = globalThis[${JSON.stringify(fixtureKey)}];
    export const IosAuthorizationStatus = { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 };
    export const SchedulableTriggerInputTypes = { DATE: 'date', TIME_INTERVAL: 'timeInterval' };
    export const setNotificationHandler = (handler) => { state.handler = handler; };
    export const getPermissionsAsync = async () => state.permission;
    export const requestPermissionsAsync = async (request) => {
      state.requested.push(request);
      state.permission = { ...state.permission, granted: true, status: 'granted', ios: { ...state.permission.ios, status: 2 } };
      return state.permission;
    };
    export const getAllScheduledNotificationsAsync = async () => [...state.pending.values()];
    export const scheduleNotificationAsync = async (request) => { state.pending.set(request.identifier, request); return request.identifier; };
    export const cancelScheduledNotificationAsync = async (identifier) => { state.pending.delete(identifier); };
  `);
  const platformUrl = asModuleUrl("export const Platform = { OS: 'ios' };");
  const source = notificationSource
    .replace(/from ['"]expo-notifications['"]/, `from ${JSON.stringify(nativeUrl)}`)
    .replace(/from ['"]react-native['"]/, `from ${JSON.stringify(platformUrl)}`)
    .replaceAll(/from ['"]@\/lib\/notification-schedule['"]/g, `from ${JSON.stringify(helperUrl)}`);
  return { state, api: await import(asModuleUrl(source)) };
}

test('background synchronization does not show the permission prompt; explicit enabling requests alerts and sound', async () => {
  const { state, api } = await notificationApiFixture({
    granted: false, status: 'undetermined', canAskAgain: true, ios: { status: 0 },
  });
  const futureTask = task(1, { dueAt: '2099-10-07T12:00:00Z' });
  await api.syncTaskNotifications([futureTask]);
  assert.equal(state.requested.length, 0);
  assert.equal(state.pending.size, 0);
  await api.enableTaskReminders([futureTask]);
  assert.deepEqual(state.requested, [{ ios: { allowAlert: true, allowSound: true, allowBadge: false, allowProvisional: false } }]);
  assert.equal(state.pending.size, 1);
  const behavior = await state.handler.handleNotification();
  assert.equal(behavior.shouldShowBanner, true);
  assert.equal(behavior.shouldShowList, true);
  assert.equal(behavior.shouldPlaySound, true);
});

test('provisional authorization can schedule without claiming audible lock-screen access', async () => {
  const { api, state } = await notificationApiFixture({
    granted: false, status: 'granted', canAskAgain: true,
    ios: { status: 3, allowsDisplayOnLockScreen: false, allowsSound: false },
  });
  const futureTask = task(1, { dueAt: '2099-10-07T12:00:00Z' });
  await api.syncTaskNotifications([futureTask]);
  const status = await api.getReminderStatus([futureTask]);
  assert.equal(state.requested.length, 0);
  assert.equal(status.granted, true);
  assert.equal(status.authorization, 'quiet');
  assert.equal(status.lockScreen, false);
  assert.equal(status.sound, false);
  assert.equal(status.scheduledCount, 1);
});

test('lock-screen test uses one identifier and a ten-second native trigger', async () => {
  const { api, state } = await notificationApiFixture({
    granted: true, status: 'granted', canAskAgain: true, ios: { status: 2 },
  });
  await api.scheduleReminderTest();
  await api.scheduleReminderTest();
  assert.equal(state.pending.size, 1);
  assert.deepEqual(state.pending.get('cardworkbench-reminder-test').trigger, {
    type: 'timeInterval', seconds: 10, repeats: false,
  });
  assert.equal(state.pending.get('cardworkbench-reminder-test').content.sound, 'default');
  assert.equal((await api.getReminderStatus([])).scheduledCount, 0);
});
