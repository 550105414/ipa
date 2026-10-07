import * as Notifications from 'expo-notifications';

import { Platform } from 'react-native';

import {
  buildTaskReminderPlan,
  createTaskReminderScheduler,
  TASK_NOTIFICATION_SOURCE,
} from '@/lib/notification-schedule';
import type { TodoTask } from '@/types/todo';

export { getTaskReminderDate } from '@/lib/notification-schedule';

export type ReminderPermission = {
  supported: boolean;
  granted: boolean;
  canAskAgain: boolean;
  authorization: 'not-requested' | 'denied' | 'quiet' | 'allowed' | 'unsupported';
  lockScreen: boolean | null;
  sound: boolean | null;
  alert: boolean | null;
};

export type ReminderStatus = ReminderPermission & {
  scheduledCount: number;
  requestedCount: number;
  deferredCount: number;
  nextReminderAt: string | null;
  error: string | null;
};

const TEST_NOTIFICATION_IDENTIFIER = 'cardworkbench-reminder-test';
let lastSchedulingError: string | null = null;
let permissionRequest: Promise<ReminderPermission> | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function readPermission(permission: Notifications.NotificationPermissionsStatus): ReminderPermission {
  const ios = permission.ios;
  const quiet = ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  const granted = permission.granted || quiet ||
    ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL;
  const undetermined = ios
    ? ios.status === Notifications.IosAuthorizationStatus.NOT_DETERMINED
    : permission.status === 'undetermined';
  return {
    supported: true,
    granted,
    canAskAgain: permission.canAskAgain,
    authorization: quiet ? 'quiet' : granted ? 'allowed' : undetermined ? 'not-requested' : 'denied',
    lockScreen: ios?.allowsDisplayOnLockScreen ?? null,
    sound: ios?.allowsSound ?? null,
    alert: ios?.allowsAlert ?? null,
  };
}

const unsupportedPermission: ReminderPermission = {
  supported: false,
  granted: false,
  canAskAgain: false,
  authorization: 'unsupported',
  lockScreen: null,
  sound: null,
  alert: null,
};

export async function getReminderPermission(): Promise<ReminderPermission> {
  if (Platform.OS === 'web') return unsupportedPermission;
  return readPermission(await Notifications.getPermissionsAsync());
}

/** Call only after a user asks for reminders or saves a future-dated task. */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (permissionRequest) return permissionRequest;
  permissionRequest = (async () => {
    const current = await getReminderPermission();
    if (!current.supported || current.authorization === 'allowed' || !current.canAskAgain) return current;
    return readPermission(await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false, allowProvisional: false },
    }));
  })().finally(() => { permissionRequest = null; });
  return permissionRequest;
}

const scheduler = createTaskReminderScheduler({
  canSchedule: async () => (await getReminderPermission()).granted,
  getScheduled: async () => Platform.OS === 'web' ? [] :
    (await Notifications.getAllScheduledNotificationsAsync()).map((request) => ({
      identifier: request.identifier,
      source: request.content.data?.source,
      taskId: request.content.data?.taskId,
      signature: request.content.data?.signature,
    })),
  schedule: async (reminder) => {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.identifier,
      content: {
        title: reminder.title,
        subtitle: reminder.subtitle,
        body: reminder.body,
        sound: 'default',
        data: {
          source: TASK_NOTIFICATION_SOURCE,
          taskId: reminder.taskId,
          signature: reminder.signature,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.scheduledAt),
      },
    });
  },
  cancel: async (identifier) => {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  },
});

/** Background reconciliation never prompts for permission, and never cancels everything first. */
export async function syncTaskNotifications(tasks: TodoTask[]): Promise<void> {
  try {
    await scheduler.sync(tasks);
    lastSchedulingError = null;
  } catch (error) {
    lastSchedulingError = error instanceof Error ? error.message : '提醒预定失败，请重试。';
    throw error;
  }
}

export async function getReminderStatus(tasks: TodoTask[]): Promise<ReminderStatus> {
  await scheduler.waitForIdle().catch(() => undefined);
  const permission = await getReminderPermission();
  const plan = buildTaskReminderPlan(tasks, Date.now());
  const scheduled = permission.supported ? await Notifications.getAllScheduledNotificationsAsync() : [];
  const scheduledCount = scheduled.filter((request) => request.content.data?.source === TASK_NOTIFICATION_SOURCE &&
    plan.reminders.some((reminder) => reminder.identifier === request.identifier &&
      reminder.signature === request.content.data?.signature)).length;
  return {
    ...permission,
    scheduledCount,
    requestedCount: plan.requestedCount,
    deferredCount: plan.deferredCount,
    nextReminderAt: plan.reminders[0] ? new Date(plan.reminders[0].scheduledAt).toISOString() : null,
    error: lastSchedulingError,
  };
}

export async function enableTaskReminders(tasks: TodoTask[]): Promise<ReminderStatus> {
  await requestReminderPermission();
  await syncTaskNotifications(tasks);
  return getReminderStatus(tasks);
}

/** One pending test at a time; it remains scheduled while the app is locked/backgrounded. */
export async function scheduleReminderTest(): Promise<ReminderPermission> {
  const permission = await requestReminderPermission();
  if (!permission.granted) return permission;
  await Notifications.scheduleNotificationAsync({
    identifier: TEST_NOTIFICATION_IDENTIFIER,
    content: {
      title: '锁屏提醒测试',
      subtitle: '工作台',
      body: '提醒已送达。正式待办会在你设置的日期和时间提醒。',
      sound: 'default',
      data: { source: 'cardworkbench-reminder-test' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 10, repeats: false },
  });
  return permission;
}
