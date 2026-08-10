import type { SQLiteDatabase } from 'expo-sqlite';

import type { NewTodoInput, TodoCategory, TodoTask } from '@/types/todo';

const DATABASE_VERSION = 2;

type CategoryRow = {
  id: string;
  name: string;
  color: string;
  tint: string;
  icon: string;
  sort_order: number;
};

type TodoRow = {
  id: number;
  title: string;
  notes: string | null;
  label: string | null;
  category_id: string;
  category_name: string;
  category_color: string;
  category_tint: string;
  category_icon: string;
  is_starred: number;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function migrateDatabase(database: SQLiteDatabase) {
  await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const versionRow = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion >= DATABASE_VERSION) {
    return;
  }

  if (currentVersion < 1) {
    await database.execAsync(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    `);
  }

  if (currentVersion < 2) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS todo_categories (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        tint TEXT NOT NULL,
        icon TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS todo_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        notes TEXT,
        label TEXT,
        category_id TEXT NOT NULL REFERENCES todo_categories(id),
        is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
        due_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS todo_items_category_index ON todo_items(category_id);
      CREATE INDEX IF NOT EXISTS todo_items_due_index ON todo_items(due_at);
      CREATE INDEX IF NOT EXISTS todo_items_completed_index ON todo_items(completed_at);

      INSERT OR IGNORE INTO todo_categories (id, name, color, tint, icon, sort_order) VALUES
        ('inbox', '收集箱', '#5D8FCB', '#EAF1FB', 'tray', 1),
        ('media', '自媒体', '#FF9138', '#FFF0E5', 'megaphone', 2),
        ('work', '工作', '#C849D9', '#F9E9FC', 'building.2', 3),
        ('reading', '看书', '#2C8897', '#E7F3F5', 'book.closed', 4),
        ('movies', '电影', '#45C86B', '#E8F8ED', 'film', 5),
        ('shopping', '购物', '#B58E70', '#F5EEE8', 'cart', 6);

      INSERT INTO todo_items (title, notes, label, category_id, is_starred, due_at)
      SELECT '订购桶装水', NULL, '生活', 'inbox', 1, date('now', 'localtime')
      WHERE NOT EXISTS (SELECT 1 FROM todo_items);
      INSERT INTO todo_items (title, notes, category_id, is_starred)
      SELECT '洗衣服', NULL, 'inbox', 1 WHERE (SELECT COUNT(*) FROM todo_items) = 1;
      INSERT INTO todo_items (title, notes, category_id, is_starred)
      SELECT '整理衣橱的衣服', NULL, 'inbox', 1 WHERE (SELECT COUNT(*) FROM todo_items) = 2;
      INSERT INTO todo_items (title, notes, category_id, is_starred, due_at)
      SELECT '学习如何写文章', '可以参考优秀作品', 'media', 1, date('now', 'localtime', '-1 day')
      WHERE (SELECT COUNT(*) FROM todo_items) = 3;
      INSERT INTO todo_items (title, notes, category_id, is_starred, due_at)
      SELECT '八月份选题计划', NULL, 'media', 1, date('now', 'localtime', '+14 days')
      WHERE (SELECT COUNT(*) FROM todo_items) = 4;
      INSERT INTO todo_items (title, notes, category_id, is_starred)
      SELECT '学习剪辑视频', NULL, 'media', 1 WHERE (SELECT COUNT(*) FROM todo_items) = 5;
      INSERT INTO todo_items (title, notes, label, category_id, is_starred)
      SELECT '发一篇图文笔记', NULL, '写作', 'media', 1 WHERE (SELECT COUNT(*) FROM todo_items) = 6;
      INSERT INTO todo_items (title, label, category_id, is_starred)
      SELECT 'ASO 学习', '运营', 'work', 1 WHERE (SELECT COUNT(*) FROM todo_items) = 7;
      INSERT INTO todo_items (title, category_id, is_starred)
      SELECT '设计新 APP 原型', 'work', 1 WHERE (SELECT COUNT(*) FROM todo_items) = 8;
      INSERT INTO todo_items (title, category_id, is_starred)
      SELECT '飘', 'reading', 1 WHERE (SELECT COUNT(*) FROM todo_items) = 9;
      INSERT INTO todo_items (title, category_id, is_starred)
      SELECT '活着', 'reading', 1 WHERE (SELECT COUNT(*) FROM todo_items) = 10;
      INSERT INTO todo_items (title, category_id, is_starred)
      SELECT '傲慢与偏见', 'reading', 1 WHERE (SELECT COUNT(*) FROM todo_items) = 11;
      INSERT INTO todo_items (title, notes, category_id, is_starred)
      SELECT '教父', '很经典的电影', 'movies', 1 WHERE (SELECT COUNT(*) FROM todo_items) = 12;
      INSERT INTO todo_items (title, category_id, is_starred)
      SELECT '无间道', 'movies', 1 WHERE (SELECT COUNT(*) FROM todo_items) = 13;
      INSERT INTO todo_items (title, category_id, is_starred)
      SELECT '让子弹飞', 'movies', 1 WHERE (SELECT COUNT(*) FROM todo_items) = 14;
      INSERT INTO todo_items (title, label, category_id, is_starred, due_at)
      SELECT '买花生油', '生活', 'shopping', 1, date('now', 'localtime', '+1 day')
      WHERE (SELECT COUNT(*) FROM todo_items) = 15;

      INSERT INTO todo_items (title, category_id, is_starred, completed_at)
      SELECT '星际穿越', 'movies', 1, datetime('now', '-1 day')
      WHERE (SELECT COUNT(*) FROM todo_items) = 16;
      INSERT INTO todo_items (title, category_id, is_starred, completed_at)
      SELECT '收拾杂物箱', 'inbox', 1, datetime('now', '-1 day')
      WHERE (SELECT COUNT(*) FROM todo_items) = 17;
      INSERT INTO todo_items (title, category_id, is_starred, completed_at)
      SELECT 'War and Peace', 'reading', 1, datetime('now', '-2 days')
      WHERE (SELECT COUNT(*) FROM todo_items) = 18;
      INSERT INTO todo_items (title, category_id, is_starred, completed_at)
      SELECT 'AI 视频学习', 'work', 1, datetime('now', '-3 days')
      WHERE (SELECT COUNT(*) FROM todo_items) = 19;
      INSERT INTO todo_items (title, category_id, is_starred, completed_at)
      SELECT 'The Great Gatsby', 'reading', 1, datetime('now', '-30 days')
      WHERE (SELECT COUNT(*) FROM todo_items) = 20;
      INSERT INTO todo_items (title, category_id, is_starred, completed_at)
      SELECT 'Wuthering Heights', 'reading', 0, datetime('now', '-60 days')
      WHERE (SELECT COUNT(*) FROM todo_items) = 21;
      INSERT INTO todo_items (title, notes, category_id, is_starred, due_at, completed_at)
      SELECT '买一把好用的拖把', '选择可以自动沥水的拖把', 'inbox', 1,
        date('now', 'localtime', '-70 days'), datetime('now', '-69 days')
      WHERE (SELECT COUNT(*) FROM todo_items) = 22;
    `);
  }

  await database.execAsync(`PRAGMA user_version = ${DATABASE_VERSION};`);
}

export async function getCategories(database: SQLiteDatabase): Promise<TodoCategory[]> {
  const rows = await database.getAllAsync<CategoryRow>(`
    SELECT id, name, color, tint, icon, sort_order
    FROM todo_categories
    ORDER BY sort_order ASC
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    tint: row.tint,
    icon: row.icon,
    sortOrder: row.sort_order,
  }));
}

export async function getTasks(database: SQLiteDatabase): Promise<TodoTask[]> {
  const rows = await database.getAllAsync<TodoRow>(`
    SELECT
      task.id,
      task.title,
      task.notes,
      task.label,
      task.category_id,
      category.name AS category_name,
      category.color AS category_color,
      category.tint AS category_tint,
      category.icon AS category_icon,
      task.is_starred,
      task.due_at,
      task.completed_at,
      task.created_at,
      task.updated_at
    FROM todo_items AS task
    JOIN todo_categories AS category ON category.id = task.category_id
    ORDER BY
      task.completed_at IS NOT NULL ASC,
      task.is_starred DESC,
      task.due_at IS NULL ASC,
      task.due_at ASC,
      task.created_at DESC,
      task.id DESC
  `);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    notes: row.notes,
    label: row.label,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryColor: row.category_color,
    categoryTint: row.category_tint,
    categoryIcon: row.category_icon,
    isStarred: row.is_starred === 1,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function insertTask(database: SQLiteDatabase, input: NewTodoInput) {
  return database.runAsync(
    `INSERT INTO todo_items
      (title, notes, category_id, is_starred, due_at, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    input.title.trim(),
    input.notes?.trim() || null,
    input.categoryId,
    input.isStarred ? 1 : 0,
    input.dueAt,
  );
}

export async function toggleTaskStar(database: SQLiteDatabase, id: number) {
  await database.runAsync(
    `UPDATE todo_items
     SET is_starred = CASE is_starred WHEN 1 THEN 0 ELSE 1 END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    id,
  );
}

export async function toggleTaskCompletion(database: SQLiteDatabase, id: number) {
  await database.runAsync(
    `UPDATE todo_items
     SET completed_at = CASE
       WHEN completed_at IS NULL THEN CURRENT_TIMESTAMP
       ELSE NULL
     END,
     updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    id,
  );
}
