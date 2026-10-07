import { parseTodoDueDate } from './date';

export const TASK_NOTIFICATION_SOURCE = 'cardworkbench-todo';
export const MAX_SCHEDULED_TASK_REMINDERS = 32;

export type ReminderTask = {
  id: number;
  title: string;
  notes: string | null;
  dueAt: string | null;
  completedAt: string | null;
};

export type PlannedTaskReminder = {
  identifier: string;
  taskId: string;
  title: string;
  subtitle: string;
  body: string;
  scheduledAt: number;
  signature: string;
};

export type ScheduledReminderSnapshot = {
  identifier: string;
  source?: unknown;
  taskId?: unknown;
  signature?: unknown;
};

export type ReminderScheduleAdapter = {
  canSchedule: () => Promise<boolean>;
  getScheduled: () => Promise<ScheduledReminderSnapshot[]>;
  schedule: (reminder: PlannedTaskReminder) => Promise<void>;
  cancel: (identifier: string) => Promise<void>;
};

/** All-day tasks remind at 09:00 locally; the widget keeps its separate midnight rule. */
export function getTaskReminderDate(dueAt: string | null): Date | null {
  const date = parseTodoDueDate(dueAt);
  if (date && dueAt?.trim().length === 10) date.setHours(9, 0, 0, 0);
  return date;
}

export function buildTaskReminderPlan(
  tasks: readonly ReminderTask[],
  now: number,
  maximum = MAX_SCHEDULED_TASK_REMINDERS,
) {
  const reminders: PlannedTaskReminder[] = [];
  for (const task of tasks) {
    if (task.completedAt) continue;
    const date = getTaskReminderDate(task.dueAt);
    if (!date || date.getTime() <= now) continue;
    const taskId = String(task.id);
    const subtitle = `工作台 · ${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const body = task.notes?.trim() || '约定时间到了，点击查看待办。';
    const scheduledAt = date.getTime();
    reminders.push({
      identifier: `${TASK_NOTIFICATION_SOURCE}-${taskId}`,
      taskId,
      title: task.title,
      subtitle,
      body,
      scheduledAt,
      signature: JSON.stringify([1, taskId, task.title, subtitle, body, scheduledAt]),
    });
  }
  reminders.sort((left, right) => left.scheduledAt - right.scheduledAt || Number(left.taskId) - Number(right.taskId));
  return {
    reminders: reminders.slice(0, maximum),
    requestedCount: reminders.length,
    deferredCount: Math.max(0, reminders.length - maximum),
  };
}

/** Serial, latest-wins reconciliation: scheduling the same identifier replaces it atomically on iOS. */
export function createTaskReminderScheduler(
  adapter: ReminderScheduleAdapter,
  now: () => number = Date.now,
) {
  let latestTasks: ReminderTask[] = [];
  let revision = 0;
  let processedRevision = 0;
  let running: Promise<void> | null = null;

  const reconcile = async (tasks: ReminderTask[], currentRevision: number) => {
    const allowed = await adapter.canSchedule();
    const scheduled = await adapter.getScheduled();
    if (currentRevision !== revision) return;
    const desired = allowed ? buildTaskReminderPlan(tasks, now()).reminders : [];
    const desiredById = new Map(desired.map((reminder) => [reminder.identifier, reminder]));
    const successfulTaskIds = new Set<string>();
    let firstError: unknown;

    for (const reminder of desired) {
      if (currentRevision !== revision) return;
      const existing = scheduled.find((item) =>
        item.identifier === reminder.identifier && item.source === TASK_NOTIFICATION_SOURCE);
      if (existing?.signature === reminder.signature) {
        successfulTaskIds.add(reminder.taskId);
        continue;
      }
      try {
        // Do not cancel first: a failed replacement must leave the previous reminder intact.
        await adapter.schedule(reminder);
        successfulTaskIds.add(reminder.taskId);
      } catch (error) {
        firstError ??= error;
      }
    }

    for (const existing of scheduled) {
      if (currentRevision !== revision) return;
      if (existing.source !== TASK_NOTIFICATION_SOURCE || desiredById.has(existing.identifier)) continue;
      // Legacy random identifiers are retired only after their replacement was installed.
      if (desired.some((item) => item.taskId === String(existing.taskId)) &&
          !successfulTaskIds.has(String(existing.taskId))) continue;
      try {
        await adapter.cancel(existing.identifier);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  };

  const sync = (tasks: readonly ReminderTask[]): Promise<void> => {
    latestTasks = tasks.map((task) => ({ ...task }));
    revision += 1;
    if (!running) {
      running = (async () => {
        try {
          while (processedRevision !== revision) {
            const currentRevision = revision;
            const currentTasks = latestTasks;
            let failure: unknown;
            try {
              await reconcile(currentTasks, currentRevision);
            } catch (error) {
              failure = error;
            }
            processedRevision = currentRevision;
            // A newer edit always gets its own pass, even after an older pass failed.
            if (failure && currentRevision === revision) throw failure;
          }
        } finally {
          // Release before the worker promise settles. A .finally() continuation
          // leaves a microtask gap where a new edit can join an already-finished worker.
          running = null;
        }
      })();
    }
    return running;
  };

  return { sync, waitForIdle: () => running ?? Promise.resolve() };
}
