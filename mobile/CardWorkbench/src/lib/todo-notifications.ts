import * as Notifications from 'expo-notifications';

import { parseTodoDueDate } from '@/lib/date';
import type { TodoTask } from '@/types/todo';

const NOTIFICATION_SOURCE = 'cardworkbench-todo';
const MAX_SCHEDULED_TASKS = 32;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function syncTaskNotifications(tasks: TodoTask[]): Promise<void> {
  const permission = await Notifications.getPermissionsAsync();
  const finalPermission =
    permission.status === 'undetermined'
      ? await Notifications.requestPermissionsAsync()
      : permission;
  if (!finalPermission.granted) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((notification) => notification.content.data?.source === NOTIFICATION_SOURCE)
      .map((notification) =>
        Notifications.cancelScheduledNotificationAsync(notification.identifier),
      ),
  );

  const now = Date.now();
  const dueTasks = tasks
    .filter((task) => {
      if (task.completedAt || !task.dueAt) return false;
      const dueTime = parseTodoDueDate(task.dueAt)?.getTime() ?? NaN;
      return Number.isFinite(dueTime) && dueTime > now;
    })
    .sort((left, right) =>
      parseTodoDueDate(left.dueAt)!.getTime() - parseTodoDueDate(right.dueAt)!.getTime(),
    )
    .slice(0, MAX_SCHEDULED_TASKS);

  await Promise.all(
    dueTasks.map((task) =>
      Notifications.scheduleNotificationAsync({
        content: {
          title: '待办提醒',
          body: task.title,
          data: { source: NOTIFICATION_SOURCE, taskId: String(task.id) },
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: parseTodoDueDate(task.dueAt)!,
        },
      }),
    ),
  );
}
