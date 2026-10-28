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
  exactAlarm: boolean | null;
};

export type ReminderStatus = ReminderPermission & {
  scheduledCount: number;
  requestedCount: number;
  deferredCount: number;
  nextReminderAt: string | null;
  error: string | null;
};

const TEST_NOTIFICATION_IDENTIFIER = 'cardworkbench-reminder-test';
export const ANDROID_REMINDER_CHANNEL_ID = 'cardworkbench-todo-reminders';
let lastSchedulingError: string | null = null;
let permissionRequest: Promise<ReminderPermission> | null = null;
let androidChannelSetup: Promise<void> | null = null;
let currentAndroidExactAlarm: boolean | null = null;
type AndroidReminderModule = {
  canScheduleExactAlarms: () => boolean;
  openExactAlarmSettings: () => boolean;
};
let androidReminderModule: Promise<AndroidReminderModule | null> | null = null;

async function getAndroidReminderModule(): Promise<AndroidReminderModule | null> {
  if (Platform.OS !== 'android') return null;
  if (!androidReminderModule) {
    // Expo SDK 55 does not expose an exact-alarm permission API in notifications.
    // The optional local widget module queries Android's AlarmManager directly.
    androidReminderModule = import('expo').then(({ requireOptionalNativeModule }) =>
      requireOptionalNativeModule<AndroidReminderModule>('CardWorkbenchWidget')).catch(() => null);
  }
  return androidReminderModule;
}

export async function openExactReminderSettings(): Promise<boolean> {
  return (await getAndroidReminderModule())?.openExactAlarmSettings() ?? false;
}

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
  // On Android 13+, the native permission flag can stay granted after the user
  // blocks all app notifications. The status also includes that global switch.
  const granted = Platform.OS === 'android'
    ? permission.granted && permission.status === 'granted'
    : permission.granted || quiet ||
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
    exactAlarm: null,
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
  exactAlarm: null,
};

/** Create a stable channel before the Android 13 permission prompt; never recreate it to evade user settings. */
async function ensureAndroidReminderChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!androidChannelSetup) {
    androidChannelSetup = Notifications.setNotificationChannelAsync(ANDROID_REMINDER_CHANNEL_ID, {
      name: '待办到期提醒',
      description: '你在工作台设置的待办日期和时间提醒。',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      enableVibrate: true,
      vibrationPattern: [0, 250, 150, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      bypassDnd: false,
      showBadge: false,
    }).then(() => undefined).catch((error) => {
      androidChannelSetup = null;
      throw error;
    });
  }
  await androidChannelSetup;
}

export async function getReminderPermission(): Promise<ReminderPermission> {
  if (Platform.OS === 'web') return unsupportedPermission;
  await ensureAndroidReminderChannel();
  const permission = readPermission(await Notifications.getPermissionsAsync());
  if (Platform.OS !== 'android') return permission;
  // Channels can be silenced independently of the app permission. Read them
  // again when the app resumes rather than treating a past grant as permanent.
  const channel = await Notifications.getNotificationChannelAsync(ANDROID_REMINDER_CHANNEL_ID);
  const blocked = channel?.importance === Notifications.AndroidImportance.NONE;
  let exactAlarm: boolean | null = null;
  try {
    exactAlarm = (await getAndroidReminderModule())?.canScheduleExactAlarms() ?? null;
  } catch {
    // Unknown is not a grant: keep reminders usable via Expo's inexact fallback.
  }
  return {
    ...permission,
    granted: permission.granted && !blocked,
    canAskAgain: permission.canAskAgain && !blocked,
    authorization: blocked ? 'denied' : permission.authorization,
    sound: channel ? channel.sound !== null : null,
    lockScreen: channel?.lockscreenVisibility === Notifications.AndroidNotificationVisibility.SECRET ? false : null,
    alert: channel ? channel.importance >= Notifications.AndroidImportance.HIGH : null,
    exactAlarm,
  };
}

/** Call only after a user asks for reminders or saves a future-dated task. */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (permissionRequest) return permissionRequest;
  permissionRequest = (async () => {
    const current = await getReminderPermission();
    if (!current.supported || current.authorization === 'allowed' || !current.canAskAgain) return current;
    await Notifications.requestPermissionsAsync(Platform.OS === 'android' ? undefined : {
      ios: { allowAlert: true, allowSound: true, allowBadge: false, allowProvisional: false },
    });
    return getReminderPermission();
  })().finally(() => { permissionRequest = null; });
  return permissionRequest;
}

const scheduler = createTaskReminderScheduler({
  canSchedule: async () => {
    const permission = await getReminderPermission();
    currentAndroidExactAlarm = permission.exactAlarm;
    return permission.granted;
  },
  getScheduled: async () => Platform.OS === 'web' ? [] :
    (await Notifications.getAllScheduledNotificationsAsync()).map((request) => ({
      identifier: request.identifier,
      source: request.content.data?.source,
      taskId: request.content.data?.taskId,
      // Reinstall existing inexact alarms when special access changes, even if
      // the task itself is unchanged. Also migrate any old fallback-channel requests.
      signature: Platform.OS === 'android' &&
        (request.content.data?.androidReminderPolicy !== 1 ||
          request.content.data?.androidExactAlarm !== currentAndroidExactAlarm)
        ? undefined : request.content.data?.signature,
    })),
  schedule: async (reminder) => {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.identifier,
      content: {
        title: reminder.title,
        subtitle: reminder.subtitle,
        body: reminder.body,
        sound: 'default',
        ...(Platform.OS === 'android' ? { priority: Notifications.AndroidNotificationPriority.HIGH } : {}),
        data: {
          source: TASK_NOTIFICATION_SOURCE,
          taskId: reminder.taskId,
          signature: reminder.signature,
          ...(Platform.OS === 'android' ? {
            androidReminderPolicy: 1,
            androidExactAlarm: currentAndroidExactAlarm,
          } : {}),
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.scheduledAt),
        ...(Platform.OS === 'android' ? { channelId: ANDROID_REMINDER_CHANNEL_ID } : {}),
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
      ...(Platform.OS === 'android' ? { priority: Notifications.AndroidNotificationPriority.HIGH } : {}),
      data: { source: 'cardworkbench-reminder-test' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 10,
      repeats: false,
      ...(Platform.OS === 'android' ? { channelId: ANDROID_REMINDER_CHANNEL_ID } : {}),
    },
  });
  return permission;
}
