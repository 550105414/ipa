import type { SQLiteDatabase } from 'expo-sqlite';

import type { NewTodoInput, TodoCategory, TodoTask, UpdateTodoInput } from '@/types/todo';

const DATABASE_VERSION = 5;

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

type LegacyDemoTaskRow = {
  id: number;
  title: string;
  notes: string | null;
  label: string | null;
  category_id: string;
  is_starred: number;
  due_offset_days: number | null;
  completed_offset_days: number | null;
  created_at: string;
  updated_at: string;
  remote_id: string | null;
  sync_state: string;
};

type LegacyDemoTaskSignature = Omit<
  LegacyDemoTaskRow,
  'created_at' | 'updated_at' | 'remote_id' | 'sync_state'
>;

const LEGACY_DEMO_TASKS: LegacyDemoTaskSignature[] = [
  { id: 1, title: '订购桶装水', notes: null, label: '生活', category_id: 'inbox', is_starred: 1, due_offset_days: 0, completed_offset_days: null },
  { id: 2, title: '洗衣服', notes: null, label: null, category_id: 'inbox', is_starred: 1, due_offset_days: null, completed_offset_days: null },
  { id: 3, title: '整理衣橱的衣服', notes: null, label: null, category_id: 'inbox', is_starred: 1, due_offset_days: null, completed_offset_days: null },
  { id: 4, title: '学习如何写文章', notes: '可以参考优秀作品', label: null, category_id: 'media', is_starred: 1, due_offset_days: -1, completed_offset_days: null },
  { id: 5, title: '八月份选题计划', notes: null, label: null, category_id: 'media', is_starred: 1, due_offset_days: 14, completed_offset_days: null },
  { id: 6, title: '学习剪辑视频', notes: null, label: null, category_id: 'media', is_starred: 1, due_offset_days: null, completed_offset_days: null },
  { id: 7, title: '发一篇图文笔记', notes: null, label: '写作', category_id: 'media', is_starred: 1, due_offset_days: null, completed_offset_days: null },
  { id: 8, title: 'ASO 学习', notes: null, label: '运营', category_id: 'work', is_starred: 1, due_offset_days: null, completed_offset_days: null },
  { id: 9, title: '设计新 APP 原型', notes: null, label: null, category_id: 'work', is_starred: 1, due_offset_days: null, completed_offset_days: null },
  { id: 10, title: '飘', notes: null, label: null, category_id: 'reading', is_starred: 1, due_offset_days: null, completed_offset_days: null },
  { id: 11, title: '活着', notes: null, label: null, category_id: 'reading', is_starred: 1, due_offset_days: null, completed_offset_days: null },
  { id: 12, title: '傲慢与偏见', notes: null, label: null, category_id: 'reading', is_starred: 1, due_offset_days: null, completed_offset_days: null },
  { id: 13, title: '教父', notes: '很经典的电影', label: null, category_id: 'movies', is_starred: 1, due_offset_days: null, completed_offset_days: null },
  { id: 14, title: '无间道', notes: null, label: null, category_id: 'movies', is_starred: 1, due_offset_days: null, completed_offset_days: null },
  { id: 15, title: '让子弹飞', notes: null, label: null, category_id: 'movies', is_starred: 1, due_offset_days: null, completed_offset_days: null },
  { id: 16, title: '买花生油', notes: null, label: '生活', category_id: 'shopping', is_starred: 1, due_offset_days: 1, completed_offset_days: null },
  { id: 17, title: '星际穿越', notes: null, label: null, category_id: 'movies', is_starred: 1, due_offset_days: null, completed_offset_days: -1 },
  { id: 18, title: '收拾杂物箱', notes: null, label: null, category_id: 'inbox', is_starred: 1, due_offset_days: null, completed_offset_days: -1 },
  { id: 19, title: 'War and Peace', notes: null, label: null, category_id: 'reading', is_starred: 1, due_offset_days: null, completed_offset_days: -2 },
  { id: 20, title: 'AI 视频学习', notes: null, label: null, category_id: 'work', is_starred: 1, due_offset_days: null, completed_offset_days: -3 },
  { id: 21, title: 'The Great Gatsby', notes: null, label: null, category_id: 'reading', is_starred: 1, due_offset_days: null, completed_offset_days: -30 },
  { id: 22, title: 'Wuthering Heights', notes: null, label: null, category_id: 'reading', is_starred: 0, due_offset_days: null, completed_offset_days: -60 },
  { id: 23, title: '买一把好用的拖把', notes: '选择可以自动沥水的拖把', label: null, category_id: 'inbox', is_starred: 1, due_offset_days: -70, completed_offset_days: -69 },
];

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
      WHERE 0;
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

  if (currentVersion < 3) {
    const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(todo_items)');
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has('remote_id')) {
      await database.execAsync('ALTER TABLE todo_items ADD COLUMN remote_id TEXT;');
    }
    if (!columnNames.has('sync_state')) {
      await database.execAsync(
        "ALTER TABLE todo_items ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'pending';",
      );
    }
    if (!columnNames.has('last_synced_at')) {
      await database.execAsync('ALTER TABLE todo_items ADD COLUMN last_synced_at TEXT;');
    }
    await database.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS todo_items_remote_id_index
      ON todo_items(remote_id)
      WHERE remote_id IS NOT NULL;
    `);
  }

  if (currentVersion < 4) {
    await removeExactLegacyDemoTasks(database);
  }

  if (currentVersion < 5) {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS credential_categories (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        tint TEXT NOT NULL,
        icon TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS credential_entries (
        id TEXT PRIMARY KEY NOT NULL,
        platform_name TEXT NOT NULL,
        category_id TEXT NOT NULL REFERENCES credential_categories(id),
        icon TEXT NOT NULL DEFAULT 'key.fill',
        encrypted_payload TEXT NOT NULL,
        key_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS credential_entries_category_index
      ON credential_entries(category_id);
      CREATE INDEX IF NOT EXISTS credential_entries_platform_index
      ON credential_entries(platform_name);

      INSERT OR IGNORE INTO credential_categories (id, name, color, tint, icon, sort_order) VALUES
        ('social', '社交', '#E9548F', '#FCEAF2', 'message.fill', 1),
        ('games', '游戏', '#755AD6', '#F0ECFC', 'gamecontroller.fill', 2),
        ('banking', '银行', '#3B82D0', '#EAF3FC', 'building.columns.fill', 3),
        ('work', '工作', '#20A878', '#E7F7F1', 'briefcase.fill', 4),
        ('shopping', '购物', '#D39B43', '#FBF3E5', 'cart.fill', 5),
        ('other', '其他', '#8D7B63', '#F2EEE9', 'folder.fill', 6);
    `);
  }

  await database.execAsync(`PRAGMA user_version = ${DATABASE_VERSION};`);
}

async function removeExactLegacyDemoTasks(database: SQLiteDatabase): Promise<void> {
  const rows = await database.getAllAsync<LegacyDemoTaskRow>(`
    SELECT
      id,
      title,
      notes,
      label,
      category_id,
      is_starred,
      CAST(
        ROUND(julianday(due_at) - julianday(date(created_at, 'localtime')))
        AS INTEGER
      ) AS due_offset_days,
      CAST(
        ROUND(julianday(completed_at) - julianday(created_at))
        AS INTEGER
      ) AS completed_offset_days,
      created_at,
      updated_at,
      remote_id,
      sync_state
    FROM todo_items
    WHERE id BETWEEN 1 AND 23
    ORDER BY id ASC
  `);

  if (rows.length !== LEGACY_DEMO_TASKS.length) return;
  const isExactUntouchedSeed = rows.every((row, index) => {
    const expected = LEGACY_DEMO_TASKS[index];
    return (
      expected !== undefined &&
      row.id === expected.id &&
      row.title === expected.title &&
      row.notes === expected.notes &&
      row.label === expected.label &&
      row.category_id === expected.category_id &&
      row.is_starred === expected.is_starred &&
      row.due_offset_days === expected.due_offset_days &&
      row.completed_offset_days === expected.completed_offset_days &&
      row.created_at === row.updated_at &&
      row.remote_id === null &&
      row.sync_state === 'pending'
    );
  });
  if (!isExactUntouchedSeed) return;

  await database.runAsync(`
    DELETE FROM todo_items
    WHERE id BETWEEN 1 AND 23
      AND updated_at = created_at
      AND remote_id IS NULL
      AND sync_state = 'pending'
  `);
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
  const updatedAt = new Date().toISOString();
  return database.runAsync(
    `INSERT INTO todo_items
      (title, notes, category_id, is_starred, due_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    input.title.trim(),
    input.notes?.trim() || null,
    input.categoryId,
    input.isStarred ? 1 : 0,
    input.dueAt,
    updatedAt,
  );
}

export async function updateTask(database: SQLiteDatabase, input: UpdateTodoInput) {
  const updatedAt = new Date().toISOString();
  await database.runAsync(
    `UPDATE todo_items
     SET title = ?,
         notes = ?,
         category_id = ?,
         is_starred = ?,
         due_at = ?,
         sync_state = 'pending',
         updated_at = ?
     WHERE id = ?`,
    input.title.trim(),
    input.notes?.trim() || null,
    input.categoryId,
    input.isStarred ? 1 : 0,
    input.dueAt,
    updatedAt,
    input.id,
  );
}

export async function toggleTaskStar(database: SQLiteDatabase, id: number) {
  const updatedAt = new Date().toISOString();
  await database.runAsync(
    `UPDATE todo_items
     SET is_starred = CASE is_starred WHEN 1 THEN 0 ELSE 1 END,
         updated_at = ?
     WHERE id = ?`,
    updatedAt,
    id,
  );
}

export async function toggleTaskCompletion(database: SQLiteDatabase, id: number) {
  const updatedAt = new Date().toISOString();
  await database.runAsync(
    `UPDATE todo_items
     SET completed_at = CASE
       WHEN completed_at IS NULL THEN CURRENT_TIMESTAMP
       ELSE NULL
     END,
     sync_state = 'pending',
     updated_at = ?
     WHERE id = ?`,
    updatedAt,
    id,
  );
}
