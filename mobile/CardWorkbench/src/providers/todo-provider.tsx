import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import {
  getCategories,
  getTasks,
  insertTask,
  toggleTaskCompletion,
  toggleTaskStar,
  updateTask as updateTaskInDatabase,
} from '@/lib/database';
import { formatDueDate } from '@/lib/date';
import { syncWorkspaceTasks, type TaskSyncResult } from '@/lib/task-sync';
import { syncTaskNotifications } from '@/lib/todo-notifications';
import type { NewTodoInput, TodoCategory, TodoTask, UpdateTodoInput } from '@/types/todo';
import { syncTodoWidget } from '@/widgets/todo-widget';
import type { TodoWidgetSyncState, WidgetSyncTask } from '@/widgets/widget-types';

export type TodoSyncStatus =
  | 'idle'
  | 'syncing'
  | 'ready'
  | 'unpaired'
  | 'offline'
  | 'widget-error';

type RefreshOptions = {
  requireCloud?: boolean;
};

export type TodoRefreshResult = {
  paired: boolean;
  remoteCount: number;
  localCount: number;
  widgetCount: number;
};

type TodoContextValue = {
  categories: TodoCategory[];
  tasks: TodoTask[];
  isLoading: boolean;
  errorMessage: string | null;
  syncStatus: TodoSyncStatus;
  syncMessage: string | null;
  syncMetrics: TodoRefreshResult;
  refresh: (options?: RefreshOptions) => Promise<TodoRefreshResult>;
  addTask: (input: NewTodoInput) => Promise<number>;
  updateTask: (input: UpdateTodoInput) => Promise<void>;
  toggleCompleted: (id: number) => Promise<void>;
  toggleStarred: (id: number) => Promise<void>;
};

const EMPTY_METRICS: TodoRefreshResult = {
  paired: false,
  remoteCount: 0,
  localCount: 0,
  widgetCount: 0,
};

const TodoContext = createContext<TodoContextValue | null>(null);

export function TodoProvider({ children }: PropsWithChildren) {
  const database = useSQLiteContext();
  const [categories, setCategories] = useState<TodoCategory[]>([]);
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<TodoSyncStatus>('idle');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncMetrics, setSyncMetrics] = useState<TodoRefreshResult>(EMPTY_METRICS);
  const syncMetricsRef = useRef<TodoRefreshResult>(EMPTY_METRICS);
  const refreshGeneration = useRef(0);

  const publishLocalState = useCallback(
    async (generation: number, widgetState: TodoWidgetSyncState) => {
      const [nextCategories, nextTasks] = await Promise.all([
        getCategories(database),
        getTasks(database),
      ]);
      if (generation !== refreshGeneration.current) return null;

      // Update the screen before waiting for WidgetKit so taps feel immediate.
      setCategories(nextCategories);
      setTasks(nextTasks);
      setErrorMessage(null);
      void syncTaskNotifications(nextTasks).catch(() => undefined);

      const widgetTasks: WidgetSyncTask[] = nextTasks.map((task) => ({
        id: String(task.id),
        title: task.title,
        color: task.categoryColor,
        completedAt: task.completedAt,
        isStarred: task.isStarred,
        dueLabel: formatDueDate(task.dueAt),
      }));

      try {
        const widget = await syncTodoWidget(widgetTasks, widgetState);
        if (generation !== refreshGeneration.current) return null;
        return { localCount: nextTasks.length, widgetCount: widget.total, widgetError: null };
      } catch (error) {
        if (generation !== refreshGeneration.current) return null;
        return {
          localCount: nextTasks.length,
          widgetCount: 0,
          widgetError:
            error instanceof Error ? error.message : '小组件写入失败，请打开工作台重试。',
        };
      }
    },
    [database],
  );

  const refresh = useCallback(
    async (options: RefreshOptions = {}): Promise<TodoRefreshResult> => {
      const generation = ++refreshGeneration.current;
      setSyncStatus('syncing');
      setSyncMessage('正在同步网页、手机和桌面小组件…');

      let cloud: TaskSyncResult = {
        paired: false,
        pulled: 0,
        pushed: 0,
        remoteCount: 0,
      };
      let cloudError: unknown;
      try {
        cloud = await syncWorkspaceTasks(database);
      } catch (error) {
        cloudError = error;
      }

      try {
        const local = await publishLocalState(
          generation,
          cloudError ? 'error' : cloud.paired ? 'ready' : 'unpaired',
        );
        if (!local) return syncMetricsRef.current;

        const metrics: TodoRefreshResult = {
          paired: cloud.paired,
          remoteCount: cloud.remoteCount,
          localCount: local.localCount,
          widgetCount: local.widgetCount,
        };
        syncMetricsRef.current = metrics;
        setSyncMetrics(metrics);

        if (local.widgetError) {
          setSyncStatus('widget-error');
          setSyncMessage(`小组件同步失败：${local.widgetError}`);
        } else if (cloudError) {
          setSyncStatus('offline');
          setSyncMessage('网络同步失败，本机改动已保留。点击重试。');
        } else if (!cloud.paired) {
          setSyncStatus('unpaired');
          setSyncMessage('尚未连接电脑工作台，待办目前仅保存在本机。');
        } else {
          setSyncStatus('ready');
          setSyncMessage(`已同步：云端 ${cloud.remoteCount} 条，小组件 ${local.widgetCount} 条`);
        }

        if (options.requireCloud && (cloudError || !cloud.paired)) {
          throw cloudError instanceof Error
            ? cloudError
            : new Error('这台 iPhone 尚未完成工作台配对。');
        }
        return metrics;
      } catch (error) {
        if (generation === refreshGeneration.current) {
          setErrorMessage(error instanceof Error ? error.message : '待办数据读取失败');
        }
        throw error;
      } finally {
        if (generation === refreshGeneration.current) setIsLoading(false);
      }
    },
    [database, publishLocalState],
  );

  const publishMutationImmediately = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    setSyncStatus('syncing');
    setSyncMessage('本机已更新，正在同步到网页…');
    const local = await publishLocalState(generation, syncMetrics.paired ? 'ready' : 'unpaired');
    if (local?.widgetError) {
      setSyncStatus('widget-error');
      setSyncMessage(`小组件同步失败：${local.widgetError}`);
    }
    // Network work is intentionally detached from the tap. SQLite and the
    // widget are already current; cloud reconciliation continues in background.
    void refresh().catch(() => undefined);
  }, [publishLocalState, refresh, syncMetrics.paired]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [refresh]);

  const addTask = useCallback(
    async (input: NewTodoInput) => {
      const result = await insertTask(database, input);
      await publishMutationImmediately();
      return result.lastInsertRowId;
    },
    [database, publishMutationImmediately],
  );

  const toggleCompleted = useCallback(
    async (id: number) => {
      await toggleTaskCompletion(database, id);
      await publishMutationImmediately();
    },
    [database, publishMutationImmediately],
  );

  const updateTask = useCallback(
    async (input: UpdateTodoInput) => {
      await updateTaskInDatabase(database, input);
      await publishMutationImmediately();
    },
    [database, publishMutationImmediately],
  );

  const toggleStarred = useCallback(
    async (id: number) => {
      await toggleTaskStar(database, id);
      await publishMutationImmediately();
    },
    [database, publishMutationImmediately],
  );

  const value = useMemo<TodoContextValue>(
    () => ({
      categories,
      tasks,
      isLoading,
      errorMessage,
      syncStatus,
      syncMessage,
      syncMetrics,
      refresh,
      addTask,
      updateTask,
      toggleCompleted,
      toggleStarred,
    }),
    [
      addTask,
      categories,
      errorMessage,
      isLoading,
      refresh,
      syncMessage,
      syncMetrics,
      syncStatus,
      tasks,
      toggleCompleted,
      toggleStarred,
      updateTask,
    ],
  );

  return <TodoContext value={value}>{children}</TodoContext>;
}

export function useTodos() {
  const context = use(TodoContext);
  if (!context) throw new Error('useTodos 必须在 TodoProvider 内使用');
  return context;
}
