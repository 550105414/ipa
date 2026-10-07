import { parseTodoDueDate } from '../lib/date';
import type {
  TodoWidgetSnapshot,
  TodoWidgetSyncState,
  TodoWidgetTask,
  WidgetSyncTask,
} from './widget-types';

const MAX_FUTURE_ENTRIES = 64;

export function parseWidgetDueAt(value: string | null | undefined): Date | null {
  return parseTodoDueDate(value ?? null);
}

function isVisible(task: TodoWidgetTask, at: Date): boolean {
  const raw = task.dueAt?.trim();
  if (!raw) return true;
  const due = parseWidgetDueAt(raw);
  // A malformed scheduled date must not accidentally become an undated task.
  return due !== null && due.getTime() <= at.getTime();
}

export function getVisibleWidgetTasks(
  snapshot: TodoWidgetSnapshot,
  at: Date,
): TodoWidgetTask[] {
  return snapshot.tasks.filter((task) => isVisible(task, at));
}

export function createWidgetSnapshot(
  tasks: WidgetSyncTask[],
  syncState: TodoWidgetSyncState = 'ready',
  now = new Date(),
): TodoWidgetSnapshot {
  const snapshot: TodoWidgetSnapshot = {
    schemaVersion: 2,
    updatedAt: now.toISOString(),
    syncState,
    total: 0,
    // Keep future tasks for WidgetKit to reveal while the app is suspended.
    // Do not truncate before time filtering: the first eight may all be future.
    tasks: tasks
      .filter((task) => !task.completedAt && !task.isCompleted && task.title.trim())
      .map((task) => ({
        id: String(task.id),
        title: task.title.trim(),
        accent: task.color || '#3B78B9',
        starred: task.isStarred ?? task.starred ?? false,
        dueAt: task.dueAt?.trim() || null,
        dueLabel: task.dueLabel?.trim() || null,
      })),
  };
  snapshot.total = getVisibleWidgetTasks(snapshot, now).length;
  return snapshot;
}

export function buildWidgetTimeline(
  snapshot: TodoWidgetSnapshot,
  now = new Date(),
): { date: number; props: TodoWidgetSnapshot }[] {
  const future = snapshot.tasks
    .map((task) => parseWidgetDueAt(task.dueAt)?.getTime())
    .filter((date): date is number => date !== undefined && date > now.getTime());
  const dates = [now.getTime(), ...[...new Set(future)]
    .sort((a, b) => a - b).slice(0, MAX_FUTURE_ENTRIES)];
  return dates.map((date) => {
    const tasks = getVisibleWidgetTasks(snapshot, new Date(date));
    return { date, props: { ...snapshot, tasks, total: tasks.length } };
  });
}
