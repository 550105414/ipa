import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

/** Notification content is data, never an arbitrary route to navigate to. */
export function NotificationNavigation() {
  const response = Notifications.useLastNotificationResponse();
  const navigation = useRootNavigationState();
  const router = useRouter();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response || !navigation?.key) return;
    const request = response.notification.request;
    // One task keeps its identifier across edits. Deduplicate this delivery,
    // not the task, so a later reminder can still open the same task.
    const delivery = `${request.identifier}:${response.notification.date}:${response.actionIdentifier}`;
    if (handled.current === delivery) return;
    handled.current = delivery;
    const data = request.content.data ?? {};
    const taskId = Number(data.taskId);
    if (data.source === 'cardworkbench-todo' && Number.isSafeInteger(taskId) && taskId > 0) {
      router.push({ pathname: '/add-task', params: { task: String(taskId) } });
    } else if (data.source === 'cardworkbench-reminder-test') {
      router.push('/plan');
    }
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }, [navigation?.key, response, router]);

  return null;
}
