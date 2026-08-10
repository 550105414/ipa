type WidgetTask = {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
};

type IOSMessageHandler = {
  postMessage(message: unknown): void;
};

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: Record<string, IOSMessageHandler | undefined>;
    };
  }
}

export function syncOpenTasksToIOSWidget(tasks: WidgetTask[]): void {
  const handler = window.webkit?.messageHandlers?.todoSnapshot;
  if (!handler) return;

  handler.postMessage({
    version: 1,
    generatedAt: new Date().toISOString(),
    items: tasks
      .filter((task) => task.status === "open")
      .slice(0, 20)
      .map((task) => ({
        id: task.id,
        title: task.title.slice(0, 200),
        dueAt: task.due_at,
      })),
  });
}
