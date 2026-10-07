export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly';
export type TaskRepeatRule = RepeatRule;

export type TodoCategory = {
  id: string;
  name: string;
  color: string;
  tint: string;
  icon: string;
  sortOrder: number;
};

export type TodoTask = {
  id: number;
  title: string;
  notes: string | null;
  label: string | null;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  categoryTint: string;
  categoryIcon: string;
  isStarred: boolean;
  dueAt: string | null;
  repeatRule: RepeatRule;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewTodoInput = {
  title: string;
  notes?: string;
  categoryId: string;
  isStarred: boolean;
  dueAt: string | null;
  repeatRule?: RepeatRule;
};

export type UpdateTodoInput = NewTodoInput & {
  id: number;
};
