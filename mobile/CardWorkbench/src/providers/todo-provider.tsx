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

export type TodoWidgetStatus = 'idle' | 'updating' | 'updated' | 'error';

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
  widgetStatus: TodoWidgetStatus;
  widgetUpdatedAt: string | null;
  widgetError: string | null;
  reminderError: string | null;
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
  const [widgetStatus, setWidgetStatus] = useState<TodoWidgetStatus>('idle');
  const [widgetUpdatedAt, setWidgetUpdatedAt] = useState<string | null>(null);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const syncMetricsRef = useRef<TodoRefreshResult>(EMPTY_METRICS);
  const refreshGeneration = useRef(0);
  const widgetStateRef = useRef<TodoWidgetSyncState>('unpaired');

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
      // SQLite is the first render source. Neither a slow network nor WidgetKit
      // should leave existing local tasks hidden behind the loading screen.
      setIsLoading(false);
      void syncTaskNotifications(nextTasks).then(
        () => {
          if (generation === refreshGeneration.current) setReminderError(null);
        },
        (error: unknown) => {
          if (generation === refreshGeneration.current) {
            setReminderError(error instanceof Error ? error.message : '提醒安排失败，请重试。');
          }
        },
      );

      const widgetTasks: WidgetSyncTask[] = nextTasks.map((task) => ({
        id: String(task.id),
        title: task.title,
        color: task.categoryColor,
        completedAt: task.completedAt,
        isStarred: task.isStarred,
        dueAt: task.dueAt,
        dueLabel: formatDueDate(task.dueAt),
      }));

      setWidgetStatus('updating');
      setWidgetError(null);
      try {
        const widget = await syncTodoWidget(widgetTasks, widgetState);
        if (generation !== refreshGeneration.current) return null;
        // This confirms the shared snapshot was written, not that iOS has
        // already repainted the Home Screen; WidgetKit controls that timing.
        setWidgetStatus('updated');
        setWidgetUpdatedAt(widget.updatedAt);
        return { localCount: nextTasks.length, widgetCount: widget.total, widgetError: null };
      } catch (error) {
        if (generation !== refreshGeneration.current) return null;
        const message =
          error instanceof Error ? error.message : '小组件写入失败，请打开工作台重试。';
        setWidgetStatus('error');
        setWidgetError(message);
        return {
          localCount: nextTasks.length,
          widgetCount: 0,
          widgetError: message,
        };
      }
    },
    [database],
  );

  const refresh = useCallback(
    async (options: RefreshOptions = {}): Promise<TodoRefreshResult> => {
      const generation = ++refreshGeneration.current;
      setSyncStatus('syncing');
      setSyncMessage('正在读取本机待办，随后后台同步…');

      try {
        const initialLocal = await publishLocalState(generation, widgetStateRef.current);
        if (!initialLocal) return syncMetricsRef.current;
        syncMetricsRef.current = {
          ...syncMetricsRef.current,
          localCount: initialLocal.localCount,
          widgetCount: initialLocal.widgetCount,
        };
        setSyncMetrics(syncMetricsRef.current);
        setSyncMessage('本机待办已加载，正在后台同步网页…');
      } catch (error) {
        if (generation === refreshGeneration.current) {
          setErrorMessage(error instanceof Error ? error.message : '待办数据读取失败');
          setIsLoading(false);
          setSyncStatus('offline');
          setSyncMessage('本机待办读取失败，请重试。');
        }
        throw error;
      }

      let cloud: TaskSyncResult = {
        paired: syncMetricsRef.current.paired,
        pulled: 0,
        pushed: 0,
        remoteCount: syncMetricsRef.current.remoteCount,
      };
      let cloudError: unknown;
      try {
        cloud = await syncWorkspaceTasks(database);
      } catch (error) {
        cloudError = error;
      }

      try {
        // An edit or another refresh owns a newer generation. It requests its
        // own reconciliation pass; this earlier result must not repaint it.
        if (generation !== refreshGeneration.current) return syncMetricsRef.current;
        widgetStateRef.current = cloudError ? 'error' : cloud.paired ? 'ready' : 'unpaired';
        const local = await publishLocalState(generation, widgetStateRef.current);
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
          setSyncMessage(
            `已同步：云端 ${cloud.remoteCount} 条，本机 ${local.localCount} 条，小组件 ${local.widgetCount} 条`,
          );
        }

        if (options.requireCloud && (cloudError || !cloud.paired)) {
          throw cloudError instanceof Error
            ? cloudError
            : new Error('这台 iPhone 尚未完成工作台配对。');
        }
        return metrics;
      } catch (error) {
        if (generation === refreshGeneration.current) {
          // A cloud-required action may reject, but offline local tasks remain
          // visible and editable instead of becoming a full-screen error.
          if (!cloudError && (!options.requireCloud || cloud.paired)) {
            setErrorMessage(error instanceof Error ? error.message : '待办数据读取失败');
          }
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
    const local = await publishLocalState(generation, widgetStateRef.current);
    if (local) {
      syncMetricsRef.current = {
        ...syncMetricsRef.current,
        localCount: local.localCount,
        widgetCount: local.widgetCount,
      };
      setSyncMetrics(syncMetricsRef.current);
    }
    if (local?.widgetError) {
      setSyncStatus('widget-error');
      setSyncMessage(`小组件同步失败：${local.widgetError}`);
    }
    // Network work is intentionally detached from the tap. SQLite and the
    // widget are already current; cloud reconciliation continues in background.
    void refresh().catch(() => undefined);
  }, [publishLocalState, refresh]);

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
      widgetStatus,
      widgetUpdatedAt,
      widgetError,
      reminderError,
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
      widgetStatus,
      widgetUpdatedAt,
      widgetError,
      reminderError,
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
