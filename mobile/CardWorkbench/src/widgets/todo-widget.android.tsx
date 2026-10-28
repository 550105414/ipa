import CardWorkbenchWidget from '../../modules/cardworkbench-widget';
import type {
  TodoWidgetSyncResult,
  TodoWidgetSyncState,
  WidgetSyncTask,
} from '@/widgets/widget-types';
import { createWidgetSnapshot } from './widget-schedule';

let pendingWrite: Promise<void> = Promise.resolve();

export async function syncTodoWidget(
  tasks: WidgetSyncTask[],
  syncState: TodoWidgetSyncState = 'ready',
): Promise<TodoWidgetSyncResult> {
  // Keep future rows in native storage: the widget's alarm reveals them even
  // while React Native is suspended. Filtering only here would lose that data.
  const snapshot = createWidgetSnapshot(tasks, syncState);
  const json = JSON.stringify(snapshot);
  const write = pendingWrite.catch(() => {}).then(() => CardWorkbenchWidget.updateSnapshot(json));
  pendingWrite = write;
  await write;
  return { total: snapshot.total, updatedAt: snapshot.updatedAt };
}
