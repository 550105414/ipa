import { localVaultAuthenticatedUserId } from "@/lib/security/local-vault-server";
import type { CustomerMachineMode, CustomerMachineType } from "@/lib/customers/machine";

export const CUSTOMER_CATEGORIES = ["直营", "代理", "汇来米", "收银通"] as const;
export type WorkspaceCustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];

export interface WorkspaceCustomerRow {
  id: string;
  owner_id: string;
  name: string;
  phone: string;
  shop_name: string | null;
  category: string;
  machine_type: CustomerMachineType | null;
  machine_mode: CustomerMachineMode | null;
  fee_rate: number | null;
  deposit_amount: number | null;
  address: string | null;
  tags_json: string;
  id_card_front_key: string | null;
  id_card_back_key: string | null;
  business_license_key: string | null;
  bank_card_ciphertext: string | null;
  bank_card_last4: string | null;
  next_follow_up_at: string | null;
  deleted_at: string | null;
  purge_after: string | null;
  created_at: string;
  updated_at: string;
}

type WorkspaceBindings = {
  DB?: D1Database;
  FILES?: R2Bucket;
};

let schemaReady: Promise<void> | null = null;

export class WorkspaceCloudConfigurationError extends Error {
  constructor(message = "云端客户资料库尚未配置") {
    super(message);
    this.name = "WorkspaceCloudConfigurationError";
  }
}

export async function getWorkspaceBindings(): Promise<{
  db: D1Database;
  files: R2Bucket;
}> {
  let bindings: WorkspaceBindings;
  try {
    const runtime = await import("cloudflare:workers");
    bindings = runtime.env as unknown as WorkspaceBindings;
  } catch {
    throw new WorkspaceCloudConfigurationError();
  }
  if (!bindings.DB || !bindings.FILES) {
    throw new WorkspaceCloudConfigurationError();
  }
  if (!schemaReady) {
    schemaReady = ensureWorkspaceSchema(bindings.DB).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return { db: bindings.DB, files: bindings.FILES };
}

async function ensureWorkspaceSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        shop_name TEXT,
        category TEXT NOT NULL DEFAULT '直营',
        machine_type TEXT,
        machine_mode TEXT,
        fee_rate REAL,
        deposit_amount REAL,
        address TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        id_card_front_key TEXT,
        id_card_back_key TEXT,
        business_license_key TEXT,
        bank_card_ciphertext TEXT,
        bank_card_last4 TEXT,
        next_follow_up_at TEXT,
        deleted_at TEXT,
        purge_after TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS customer_activity (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        customer_id TEXT,
        customer_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        customer_id TEXT,
        title TEXT NOT NULL,
        due_at TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        completed_at TEXT
      )`,
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_customers_owner_created ON customers (owner_id, created_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_customers_owner_status ON customers (owner_id, id_card_front_key, id_card_back_key)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_customers_owner_category ON customers (owner_id, category)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_customers_owner_shop_name ON customers (owner_id, shop_name)",
    ),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_owner_phone_unique ON customers (owner_id, phone)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_customers_owner_follow_up ON customers (owner_id, next_follow_up_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_customers_owner_deleted ON customers (owner_id, deleted_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_customer_activity_owner_created ON customer_activity (owner_id, created_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_customer_activity_owner_customer ON customer_activity (owner_id, customer_id)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_tasks_owner_status_due ON tasks (owner_id, status, due_at)",
    ),
  ]);
  await ensureCustomerColumns(db);
  await db.prepare("PRAGMA optimize").run();
}

async function ensureCustomerColumns(db: D1Database): Promise<void> {
  const columns = await db.prepare("PRAGMA table_info(customers)").all<{ name: string }>();
  const names = new Set((columns.results ?? []).map((column) => column.name));
  const additions = [
    ["deposit_amount", "ALTER TABLE customers ADD COLUMN deposit_amount REAL"],
    ["address", "ALTER TABLE customers ADD COLUMN address TEXT"],
    ["tags_json", "ALTER TABLE customers ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'"],
    ["business_license_key", "ALTER TABLE customers ADD COLUMN business_license_key TEXT"],
  ] as const;
  for (const [name, statement] of additions) {
    if (!names.has(name)) await db.prepare(statement).run();
  }
}

export async function isWorkspaceCloudConfigured(): Promise<boolean> {
  try {
    await getWorkspaceBindings();
    return true;
  } catch {
    return false;
  }
}

export function workspaceUserId(request: Request): string | null {
  const value = localVaultAuthenticatedUserId(request)?.trim() ?? "";
  return value.length > 0 && value.length <= 256 ? value : null;
}

export function normalizeCustomerCategory(
  value: unknown,
): WorkspaceCustomerCategory {
  return CUSTOMER_CATEGORIES.includes(value as WorkspaceCustomerCategory)
    ? (value as WorkspaceCustomerCategory)
    : "直营";
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "***";
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

export function profileStatus(row: {
  id_card_front_key: string | null;
  id_card_back_key: string | null;
}): "completed" | "draft" {
  return row.id_card_front_key && row.id_card_back_key ? "completed" : "draft";
}

export function customerObjectKey(
  ownerId: string,
  customerId: string,
  side: "front" | "back",
): string {
  return `customers/${encodeURIComponent(ownerId)}/${customerId}/id-card-${side}`;
}

export function customerBusinessLicenseObjectKey(
  ownerId: string,
  customerId: string,
): string {
  return `customers/${encodeURIComponent(ownerId)}/${customerId}/business-license`;
}

export function privateJson<T>(body: T, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "private, no-store");
  responseHeaders.set("Pragma", "no-cache");
  responseHeaders.set("Referrer-Policy", "no-referrer");
  responseHeaders.set("Vary", "Authorization, Cookie");
  return Response.json(body, { status, headers: responseHeaders });
}

export function apiError(
  status: number,
  code: string,
  message: string,
): Response {
  return privateJson({ error: { code, message } }, status);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function findOwnedCustomer(
  request: Request,
  id: string,
): Promise<{ userId: string; row: WorkspaceCustomerRow } | null> {
  const userId = workspaceUserId(request);
  if (!userId || !isUuid(id)) return null;
  const { db } = await getWorkspaceBindings();
  const row = await db
    .prepare(
      `SELECT id, owner_id, name, phone, shop_name, category,
              machine_type, machine_mode, fee_rate, deposit_amount,
              address, tags_json,
              id_card_front_key, id_card_back_key, business_license_key,
              bank_card_ciphertext, bank_card_last4,
              next_follow_up_at, deleted_at, purge_after,
              created_at, updated_at
       FROM customers
       WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(id, userId)
    .first<WorkspaceCustomerRow>();
  return row ? { userId, row } : null;
}

export function activityStatement(
  db: D1Database,
  input: {
    ownerId: string;
    customerId: string | null;
    customerName: string;
    eventType: string;
    summary: string;
    createdAt?: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO customer_activity (
        id, owner_id, customer_id, customer_name, event_type, summary, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      crypto.randomUUID(),
      input.ownerId,
      input.customerId,
      input.customerName.slice(0, 100),
      input.eventType.slice(0, 50),
      input.summary.slice(0, 300),
      input.createdAt ?? new Date().toISOString(),
    );
}
