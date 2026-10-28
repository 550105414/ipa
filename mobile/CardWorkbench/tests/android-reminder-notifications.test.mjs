import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const dateUrl = moduleUrl(compile(await readFile(new URL('../src/lib/date.ts', import.meta.url), 'utf8')));
const scheduleUrl = moduleUrl(compile(await readFile(new URL('../src/lib/notification-schedule.ts', import.meta.url), 'utf8'))
  .replace(/from ['"]\.\/date['"]/, `from ${JSON.stringify(dateUrl)}`));
const notificationSource = compile(await readFile(new URL('../src/lib/todo-notifications.ts', import.meta.url), 'utf8'));
let instance = 0;

async function fixture(patch = {}) {
  const key = `__androidReminderFixture${instance++}`;
  const state = {
    permission: { granted: true, status: 'granted', canAskAgain: true },
    channel: { importance: 6, sound: 'default', lockscreenVisibility: 2 },
    exactAlarm: false,
    nativeAvailable: true,
    channelFailure: false,
    requested: [],
    events: [],
    pending: new Map(),
    ...patch,
  };
  globalThis[key] = state;
  const notificationsUrl = moduleUrl(`
    const state = globalThis[${JSON.stringify(key)}];
    export const IosAuthorizationStatus = { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 };
    export const AndroidImportance = { NONE: 2, LOW: 4, DEFAULT: 5, HIGH: 6 };
    export const AndroidNotificationPriority = { HIGH: 'high' };
    export const AndroidNotificationVisibility = { PUBLIC: 1, PRIVATE: 2, SECRET: 3 };
    export const SchedulableTriggerInputTypes = { DATE: 'date', TIME_INTERVAL: 'timeInterval' };
    export const setNotificationHandler = (handler) => { state.handler = handler; };
    export const setNotificationChannelAsync = async (id, channel) => {
      state.events.push(['channel', id, channel]);
      if (state.channelFailure) throw new Error('channel setup failed');
      return state.channel;
    };
    export const getNotificationChannelAsync = async (id) => { state.events.push(['read-channel', id]); return state.channel; };
    export const getPermissionsAsync = async () => { state.events.push(['permission']); return state.permission; };
    export const requestPermissionsAsync = async (request) => {
      state.events.push(['request']);
      state.requested.push(request);
      state.permission = { granted: true, status: 'granted', canAskAgain: true };
      return state.permission;
    };
    export const getAllScheduledNotificationsAsync = async () => [...state.pending.values()];
    export const scheduleNotificationAsync = async (request) => { state.events.push(['schedule', request.identifier]); state.pending.set(request.identifier, request); return request.identifier; };
    export const cancelScheduledNotificationAsync = async (id) => { state.pending.delete(id); };
  `);
  const platformUrl = moduleUrl("export const Platform = { OS: 'android' };");
  const expoUrl = moduleUrl(`
    const state = globalThis[${JSON.stringify(key)}];
    export const requireOptionalNativeModule = (name) => {
      state.events.push(['native-module', name]);
      return state.nativeAvailable ? {
        canScheduleExactAlarms: () => state.exactAlarm,
        openExactAlarmSettings: () => { state.events.push(['open-alarm-settings']); return true; },
      } : null;
    };
  `);
  const source = notificationSource
    .replace(/from ['"]expo-notifications['"]/, `from ${JSON.stringify(notificationsUrl)}`)
    .replace(/from ['"]react-native['"]/, `from ${JSON.stringify(platformUrl)}`)
    .replaceAll(/from ['"]@\/lib\/notification-schedule['"]/g, `from ${JSON.stringify(scheduleUrl)}`)
    .replace(/import\(['"]expo['"]\)/g, `import(${JSON.stringify(expoUrl)})`);
  return { state, api: await import(moduleUrl(source)) };
}

const futureTask = (id = 1) => ({
  id, title: `安卓待办 ${id}`, notes: '锁屏也能提醒', dueAt: '2099-10-28T12:30:00Z', completedAt: null,
});

test('Android creates the stable notification channel before requesting Android 13 permission', async () => {
  const { api, state } = await fixture({ permission: { granted: false, status: 'undetermined', canAskAgain: true } });
  await Promise.all([api.requestReminderPermission(), api.requestReminderPermission()]);
  assert.equal(state.requested.length, 1);
  assert.equal(state.requested[0], undefined, 'do not pass iOS-only options on Android');
  const channel = state.events.find((event) => event[0] === 'channel');
  assert.equal(channel[1], api.ANDROID_REMINDER_CHANNEL_ID);
  assert.equal(channel[2].importance, 6);
  assert.equal(channel[2].sound, 'default');
  assert.equal(channel[2].bypassDnd, false);
  assert.equal(channel[2].lockscreenVisibility, 2, 'respect lock-screen content privacy');
  assert.ok(state.events.findIndex((event) => event[0] === 'channel') < state.events.findIndex((event) => event[0] === 'request'));
  assert.equal(state.events.filter((event) => event[0] === 'channel').length, 1);
});

test('Android background reconciliation never prompts and an explicit grant installs a date trigger on the channel', async () => {
  const { api, state } = await fixture({ permission: { granted: false, status: 'undetermined', canAskAgain: true } });
  await api.syncTaskNotifications([futureTask()]);
  assert.equal(state.requested.length, 0);
  assert.equal(state.pending.size, 0);
  await api.enableTaskReminders([futureTask()]);
  const request = state.pending.get('cardworkbench-todo-1');
  assert.equal(request.trigger.type, 'date');
  assert.equal(request.trigger.date.toISOString(), '2099-10-28T12:30:00.000Z');
  assert.equal(request.trigger.channelId, api.ANDROID_REMINDER_CHANNEL_ID);
  assert.equal(request.content.sound, 'default');
  assert.equal(request.content.priority, 'high');
  assert.equal(request.content.title, '安卓待办 1');
});

test('Android does not confuse global notification blocking with the granted POST_NOTIFICATIONS flag', async () => {
  const { api } = await fixture({ permission: { granted: true, status: 'denied', canAskAgain: false } });
  assert.equal((await api.getReminderPermission()).granted, false);
});

test('a blocked Android channel overrides app permission and clears only owned reminders', async () => {
  const { api, state } = await fixture();
  await api.syncTaskNotifications([futureTask()]);
  state.pending.set('other', { identifier: 'other', content: { data: { source: 'another-feature' } } });
  state.channel.importance = 2;
  const permission = await api.requestReminderPermission();
  assert.equal(permission.granted, false);
  assert.equal(permission.authorization, 'denied');
  assert.equal(permission.canAskAgain, false);
  assert.equal(state.requested.length, 0, 'permission prompt cannot override a user-blocked channel');
  await api.syncTaskNotifications([futureTask()]);
  assert.deepEqual([...state.pending.keys()], ['other']);
});

test('channel settings and exact-alarm access are read again after settings changes', async () => {
  const { api, state } = await fixture();
  let permission = await api.getReminderPermission();
  assert.equal(permission.exactAlarm, false);
  assert.equal(permission.sound, true);
  assert.equal(permission.lockScreen, null, 'do not claim to know the system-wide preview switch');
  state.exactAlarm = true;
  state.channel.sound = null;
  state.channel.lockscreenVisibility = 3;
  state.channel.importance = 4;
  permission = await api.getReminderPermission();
  assert.equal(permission.exactAlarm, true);
  assert.equal(permission.sound, false);
  assert.equal(permission.lockScreen, false);
  assert.equal(permission.alert, false);
  assert.equal(await api.openExactReminderSettings(), true);
  assert.ok(state.events.some((event) => event[0] === 'open-alarm-settings'));
});

test('missing optional exact-alarm bridge is unknown, not a false claim of a precise grant or a scheduling failure', async () => {
  const { api, state } = await fixture({ nativeAvailable: false });
  const status = await api.enableTaskReminders([futureTask()]);
  assert.equal(status.granted, true);
  assert.equal(status.exactAlarm, null);
  assert.equal(status.error, null);
  assert.equal(state.pending.size, 1);
  assert.equal(await api.openExactReminderSettings(), false);
});

test('an unchanged Android task is replaced when exact-alarm permission changes, but not on ordinary syncs', async () => {
  const { api, state } = await fixture();
  await api.syncTaskNotifications([futureTask()]);
  await api.syncTaskNotifications([futureTask()]);
  assert.equal(state.events.filter((event) => event[0] === 'schedule').length, 1);
  assert.equal(state.pending.get('cardworkbench-todo-1').content.data.androidExactAlarm, false);
  state.exactAlarm = true;
  await api.syncTaskNotifications([futureTask()]);
  assert.equal(state.events.filter((event) => event[0] === 'schedule').length, 2);
  assert.equal(state.pending.get('cardworkbench-todo-1').content.data.androidExactAlarm, true);
  await api.syncTaskNotifications([futureTask()]);
  assert.equal(state.events.filter((event) => event[0] === 'schedule').length, 2);
  state.exactAlarm = false;
  await api.syncTaskNotifications([futureTask()]);
  assert.equal(state.events.filter((event) => event[0] === 'schedule').length, 3);
  assert.equal(state.pending.size, 1);
});

test('legacy Android fallback-channel requests are migrated without duplicating the task reminder', async () => {
  const { api, state } = await fixture();
  await api.syncTaskNotifications([futureTask()]);
  delete state.pending.get('cardworkbench-todo-1').content.data.androidReminderPolicy;
  await api.syncTaskNotifications([futureTask()]);
  assert.equal(state.events.filter((event) => event[0] === 'schedule').length, 2);
  assert.equal(state.pending.get('cardworkbench-todo-1').content.data.androidReminderPolicy, 1);
  assert.equal(state.pending.size, 1);
});

test('Android test uses the same channel and stable single identifier', async () => {
  const { api, state } = await fixture();
  await api.scheduleReminderTest();
  await api.scheduleReminderTest();
  assert.equal(state.pending.size, 1);
  assert.deepEqual(state.pending.get('cardworkbench-reminder-test').trigger, {
    type: 'timeInterval', seconds: 10, repeats: false, channelId: api.ANDROID_REMINDER_CHANNEL_ID,
  });
});

test('failed Android channel creation is retryable without showing a permission prompt', async () => {
  const { api, state } = await fixture({ channelFailure: true });
  await assert.rejects(api.getReminderPermission(), /channel setup failed/);
  state.channelFailure = false;
  assert.equal((await api.getReminderPermission()).granted, true);
  assert.equal(state.events.filter((event) => event[0] === 'channel').length, 2);
  assert.equal(state.requested.length, 0);
});
