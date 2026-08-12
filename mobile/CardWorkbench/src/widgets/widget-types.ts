export type TodoWidgetTask = {
  id: string;
  title: string;
  accent: string;
  starred: boolean;
  dueLabel?: string | null;
};

export type TodoWidgetSnapshot = {
  total: number;
  tasks: TodoWidgetTask[];
  updatedAt: string;
  syncState: 'ready' | 'unpaired' | 'error';
};

export type WidgetSyncTask = {
  id: string;
  title: string;
  color?: string;
  completedAt?: string | null;
  isCompleted?: boolean;
  isStarred?: boolean;
  starred?: boolean;
  dueLabel?: string | null;
};

export type TodoWidgetSyncState = TodoWidgetSnapshot['syncState'];

export type TodoWidgetSyncResult = {
  total: number;
  updatedAt: string;
};
