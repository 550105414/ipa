import type { WidgetSyncTask } from '@/widgets/widget-types';

export function syncTodoWidget(_tasks: WidgetSyncTask[]): void {
  // WidgetKit is iOS-only. Metro selects todo-widget.ios.tsx on iOS.
}
