import type {
  TodoWidgetSyncResult,
  TodoWidgetSyncState,
  WidgetSyncTask,
} from '@/widgets/widget-types';

export async function syncTodoWidget(
  tasks: WidgetSyncTask[],
  _syncState: TodoWidgetSyncState = 'ready',
): Promise<TodoWidgetSyncResult> {
  // WidgetKit is iOS-only. Metro selects todo-widget.ios.tsx on iOS.
  return {
    total: tasks.filter((task) => !task.completedAt && task.isCompleted !== true).length,
    updatedAt: new Date().toISOString(),
  };
}
