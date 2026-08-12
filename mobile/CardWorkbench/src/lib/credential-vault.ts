import CredentialVault from '@credential-vault';
import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  CredentialCategory,
  CredentialEntry,
  CredentialSecret,
  SaveCredentialInput,
} from '@/types/credential';

type CategoryRow = {
  id: string;
  name: string;
  color: string;
  tint: string;
  icon: string;
  sort_order: number;
};

type CredentialRow = {
  id: string;
  platform_name: string;
  category_id: string;
  category_name: string;
  category_color: string;
  category_tint: string;
  category_icon: string;
  icon: string;
  encrypted_payload: string;
  key_version: number;
  created_at: string;
  updated_at: string;
};

const EMPTY_SECRET: CredentialSecret = {
  account: '',
  password: '',
  email: '',
  nickname: '',
  website: '',
  notes: '',
  tags: [],
};

export async function getCredentialCategories(
  database: SQLiteDatabase,
): Promise<CredentialCategory[]> {
  const rows = await database.getAllAsync<CategoryRow>(`
    SELECT id, name, color, tint, icon, sort_order
    FROM credential_categories
    ORDER BY sort_order ASC, name ASC
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

export async function getCredentials(database: SQLiteDatabase): Promise<CredentialEntry[]> {
  const rows = await database.getAllAsync<CredentialRow>(
    `${credentialSelect()} ORDER BY entry.updated_at DESC, entry.id DESC`,
  );
  return Promise.all(rows.map(decryptRow));
}

export async function getCredential(
  database: SQLiteDatabase,
  id: string,
): Promise<CredentialEntry | null> {
  const row = await database.getFirstAsync<CredentialRow>(
    `${credentialSelect()} WHERE entry.id = ?`,
    id,
  );
  return row ? decryptRow(row) : null;
}

export async function saveCredential(
  database: SQLiteDatabase,
  input: SaveCredentialInput,
): Promise<string> {
  const id = input.id ?? CredentialVault.newRecordId();
  const now = new Date().toISOString();
  const plaintext = JSON.stringify(normalizeSecret(input.secret));
  const encrypted = await CredentialVault.encryptAsync(id, plaintext);

  if (input.id) {
    await database.runAsync(
      `UPDATE credential_entries
       SET platform_name = ?, category_id = ?, icon = ?, encrypted_payload = ?,
           key_version = ?, updated_at = ?
       WHERE id = ?`,
      input.platformName.trim(),
      input.categoryId,
      input.icon,
      encrypted.ciphertext,
      encrypted.keyVersion,
      now,
      id,
    );
  } else {
    await database.runAsync(
      `INSERT INTO credential_entries
        (id, platform_name, category_id, icon, encrypted_payload, key_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.platformName.trim(),
      input.categoryId,
      input.icon,
      encrypted.ciphertext,
      encrypted.keyVersion,
      now,
      now,
    );
  }
  return id;
}

export async function deleteCredential(database: SQLiteDatabase, id: string): Promise<void> {
  await database.runAsync('DELETE FROM credential_entries WHERE id = ?', id);
}

export async function generateStrongPassword(
  length = 20,
  options = { uppercase: true, lowercase: true, numbers: true, symbols: true },
): Promise<string> {
  return CredentialVault.generatePasswordAsync(
    length,
    options.uppercase,
    options.lowercase,
    options.numbers,
    options.symbols,
  );
}

function credentialSelect(): string {
  return `
    SELECT entry.id, entry.platform_name, entry.category_id, entry.icon,
           entry.encrypted_payload, entry.key_version, entry.created_at, entry.updated_at,
           category.name AS category_name, category.color AS category_color,
           category.tint AS category_tint, category.icon AS category_icon
    FROM credential_entries AS entry
    JOIN credential_categories AS category ON category.id = entry.category_id
  `;
}

async function decryptRow(row: CredentialRow): Promise<CredentialEntry> {
  const plaintext = await CredentialVault.decryptAsync(
    row.id,
    row.encrypted_payload,
    row.key_version,
  );
  const secret = normalizeSecret(JSON.parse(plaintext) as Partial<CredentialSecret>);
  return {
    id: row.id,
    platformName: row.platform_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryColor: row.category_color,
    categoryTint: row.category_tint,
    categoryIcon: row.category_icon,
    icon: row.icon,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...secret,
  };
}

function normalizeSecret(secret: Partial<CredentialSecret>): CredentialSecret {
  return {
    ...EMPTY_SECRET,
    account: String(secret.account ?? '').trim(),
    password: String(secret.password ?? ''),
    email: String(secret.email ?? '').trim(),
    nickname: String(secret.nickname ?? '').trim(),
    website: String(secret.website ?? '').trim(),
    notes: String(secret.notes ?? '').trim(),
    tags: Array.isArray(secret.tags)
      ? secret.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12)
      : [],
  };
}
