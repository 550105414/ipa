import type {
  TodoWidgetSyncResult,
  TodoWidgetSyncState,
  WidgetSyncTask,
} from '@/widgets/widget-types';
import { createWidgetSnapshot } from './widget-schedule';

export async function syncTodoWidget(
  tasks: WidgetSyncTask[],
  syncState: TodoWidgetSyncState = 'ready',
): Promise<TodoWidgetSyncResult> {
  // WidgetKit is iOS-only. Metro selects todo-widget.ios.tsx on iOS.
  const snapshot = createWidgetSnapshot(tasks, syncState);
  return { total: snapshot.total, updatedAt: snapshot.updatedAt };
}
