import { useSQLiteContext } from 'expo-sqlite';
import { createContext, type PropsWithChildren, use, useCallback, useEffect, useMemo, useState } from 'react';

import {
  getCategories,
  getTasks,
  insertTask,
  toggleTaskCompletion,
  toggleTaskStar,
  updateTask as updateTaskInDatabase,
} from '@/lib/database';
import { formatDueDate } from '@/lib/date';
import type { NewTodoInput, TodoCategory, TodoTask, UpdateTodoInput } from '@/types/todo';
import { syncTodoWidget } from '@/widgets/todo-widget';

type TodoContextValue = {
  categories: TodoCategory[];
  tasks: TodoTask[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => Promise<void>;
  addTask: (input: NewTodoInput) => Promise<number>;
  updateTask: (input: UpdateTodoInput) => Promise<void>;
  toggleCompleted: (id: number) => Promise<void>;
  toggleStarred: (id: number) => Promise<void>;
};

const TodoContext = createContext<TodoContextValue | null>(null);

export function TodoProvider({ children }: PropsWithChildren) {
  const database = useSQLiteContext();
  const [categories, setCategories] = useState<TodoCategory[]>([]);
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextCategories, nextTasks] = await Promise.all([
        getCategories(database),
        getTasks(database),
      ]);
      setCategories(nextCategories);
      setTasks(nextTasks);
      try {
        syncTodoWidget(
          nextTasks.map((task) => ({
            id: String(task.id),
            title: task.title,
            color: task.categoryColor,
            completedAt: task.completedAt,
            isStarred: task.isStarred,
            dueLabel: formatDueDate(task.dueAt),
          })),
        );
      } catch {
        // Keep the app usable if WidgetKit is temporarily unavailable.
      }
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '待办数据读取失败');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [database]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const addTask = useCallback(
    async (input: NewTodoInput) => {
      const result = await insertTask(database, input);
      await refresh();
      return result.lastInsertRowId;
    },
    [database, refresh],
  );

  const toggleCompleted = useCallback(
    async (id: number) => {
      await toggleTaskCompletion(database, id);
      await refresh();
    },
    [database, refresh],
  );

  const updateTask = useCallback(
    async (input: UpdateTodoInput) => {
      await updateTaskInDatabase(database, input);
      await refresh();
    },
    [database, refresh],
  );

  const toggleStarred = useCallback(
    async (id: number) => {
      await toggleTaskStar(database, id);
      await refresh();
    },
    [database, refresh],
  );

  const value = useMemo<TodoContextValue>(
    () => ({
      categories,
      tasks,
      isLoading,
      errorMessage,
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
  if (!context) {
    throw new Error('useTodos 必须在 TodoProvider 内使用');
  }
  return context;
}
