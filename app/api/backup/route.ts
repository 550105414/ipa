import {
  decryptBankCardNumber,
  encryptBankCardNumber,
  normalizeAndValidateCardNumber,
} from "@/lib/security/bank-card";
import {
  decryptWorkspaceBackup,
  WorkspaceBackupError,
} from "@/lib/security/workspace-backup";
import {
  activityStatement,
  apiError,
  customerBusinessLicenseObjectKey,
  customerObjectKey,
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
  normalizeCustomerCategory,
  privateJson,
  workspaceUserId,
  type WorkspaceCustomerRow,
} from "@/lib/workspace/server";
import {
  isCustomerMachineMode,
  isCustomerMachineType,
  isValidCustomerFeeRate,
  type CustomerMachineMode,
  type CustomerMachineType,
} from "@/lib/customers/machine";
import {
  normalizeCustomerAddress,
  normalizeCustomerTags,
  normalizeMachineDeposit,
  parseStoredCustomerTags,
} from "@/lib/customers/profile";

const MAX_BACKUP_BYTES = 75 * 1024 * 1024;
const SAFE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

type BackupImage = { contentType: string; base64: string } | null;
type BackupCustomer = {
  name: string;
  phone: string;
  shopName: string | null;
  category: string;
  machineType: CustomerMachineType | null;
  machineMode: CustomerMachineMode | null;
  feeRate: number | null;
  depositAmount?: number | null;
  address?: string | null;
  tags?: string[];
  bankCardNumber: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
  front: BackupImage;
  back: BackupImage;
  businessLicense?: BackupImage;
};
type BackupActivity = {
  customerId: string | null;
  customerName: string;
  eventType: string;
  summary: string;
  createdAt: string;
};
type WorkspaceBackup = {
  version: 1 | 2;
  exportedAt: string;
  customers: BackupCustomer[];
  activity: BackupActivity[];
};

export async function GET(request: Request): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(409, "CLOUD_SYNC_REQUIRED", "备份需要启用云端同步");
  }
  const userId = await workspaceUserId(request);
  if (!userId) return apiError(401, "AUTH_REQUIRED", "请先登录后再导出备份");
  const { db, files } = await getWorkspaceBindings();
  const rows = await db
    .prepare(
      `SELECT id, owner_id, name, phone, shop_name, category,
              machine_type, machine_mode, fee_rate, deposit_amount,
              address, tags_json,
              id_card_front_key, id_card_back_key, business_license_key,
              bank_card_ciphertext, bank_card_last4,
              next_follow_up_at, deleted_at, purge_after,
              created_at, updated_at
       FROM customers
       WHERE owner_id = ?1
       ORDER BY created_at ASC`,
    )
    .bind(userId)
    .all<WorkspaceCustomerRow>();
  const customers: BackupCustomer[] = [];
  for (const row of rows.results ?? []) {
    customers.push({
      name: row.name,
      phone: row.phone,
      shopName: row.shop_name,
      category: normalizeCustomerCategory(row.category),
      machineType: row.machine_type,
      machineMode: row.machine_mode,
      feeRate: row.fee_rate,
      depositAmount: row.deposit_amount,
      address: row.address,
      tags: parseStoredCustomerTags(row.tags_json),
      bankCardNumber: row.bank_card_ciphertext
        ? await decryptBankCardNumber(row.bank_card_ciphertext, row.id)
        : null,
      nextFollowUpAt: row.next_follow_up_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      front: await readImage(files, row.id_card_front_key),
      back: await readImage(files, row.id_card_back_key),
      businessLicense: await readImage(files, row.business_license_key),
    });
  }
  const activities = await db
    .prepare(
      `SELECT customer_id, customer_name, event_type, summary, created_at
       FROM customer_activity
       WHERE owner_id = ?1
       ORDER BY created_at ASC
       LIMIT 5000`,
    )
    .bind(userId)
    .all<{
      customer_id: string | null;
      customer_name: string;
      event_type: string;
      summary: string;
      created_at: string;
    }>();
  const backup: WorkspaceBackup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    customers,
    activity: (activities.results ?? []).map((item) => ({
      customerId: item.customer_id,
      customerName: item.customer_name,
      eventType: item.event_type,
      summary: item.summary,
      createdAt: item.created_at,
    })),
  };
  return new Response(JSON.stringify(backup, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-workspace-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(409, "CLOUD_SYNC_REQUIRED", "恢复需要启用云端同步");
  }
  const userId = await workspaceUserId(request);
  if (!userId) return apiError(401, "AUTH_REQUIRED", "请先登录后再恢复备份");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BACKUP_BYTES) {
    return apiError(413, "BACKUP_TOO_LARGE", "备份文件不能超过 75MB");
  }
  let file: File;
  try {
    const form = (await request.formData()) as unknown as FormData;
    const value = form.get("backup");
    if (!(value instanceof File) || value.size <= 0 || value.size > MAX_BACKUP_BYTES) {
      throw new Error("invalid file");
    }
    file = value;
  } catch {
    return apiError(400, "INVALID_BACKUP_FILE", "请选择有效的 .json 或旧版 .xkbak 备份文件");
  }
  let backup: WorkspaceBackup;
  try {
    const raw = await file.text();
    try {
      backup = JSON.parse(raw) as WorkspaceBackup;
    } catch {
      backup = JSON.parse(await decryptWorkspaceBackup(raw)) as WorkspaceBackup;
    }
    if (![1, 2].includes(backup.version) || !Array.isArray(backup.customers) || backup.customers.length > 5000) {
      throw new WorkspaceBackupError();
    }
  } catch {
    return apiError(400, "INVALID_BACKUP_FILE", "备份文件无法读取、已损坏或不是本工作台生成的文件");
  }

  const { db, files } = await getWorkspaceBindings();
  let imported = 0;
  let skipped = 0;
  for (const source of backup.customers) {
    const name = typeof source.name === "string" ? source.name.trim().slice(0, 100) : "";
    const phone = normalizePhone(source.phone);
    if (!name || !/^\+?\d{7,20}$/.test(phone)) {
      skipped += 1;
      continue;
    }
    const exists = await db
      .prepare("SELECT id FROM customers WHERE owner_id = ?1 AND phone = ?2 LIMIT 1")
      .bind(userId, phone)
      .first<{ id: string }>();
    if (exists) {
      skipped += 1;
      continue;
    }
    const id = crypto.randomUUID();
    const front = decodeImage(source.front);
    const back = decodeImage(source.back);
    const businessLicense = decodeImage(source.businessLicense ?? null);
    const frontKey = front ? customerObjectKey(userId, id, "front") : null;
    const backKey = back ? customerObjectKey(userId, id, "back") : null;
    const businessLicenseKey = businessLicense
      ? customerBusinessLicenseObjectKey(userId, id)
      : null;
    const uploaded: string[] = [];
    try {
      if (front && frontKey) {
        await files.put(frontKey, front.bytes, { httpMetadata: { contentType: front.contentType } });
        uploaded.push(frontKey);
      }
      if (back && backKey) {
        await files.put(backKey, back.bytes, { httpMetadata: { contentType: back.contentType } });
        uploaded.push(backKey);
      }
      if (businessLicense && businessLicenseKey) {
        await files.put(businessLicenseKey, businessLicense.bytes, {
          httpMetadata: { contentType: businessLicense.contentType },
        });
        uploaded.push(businessLicenseKey);
      }
      const encryptedCard = source.bankCardNumber
        ? await encryptBankCardNumber(normalizeAndValidateCardNumber(source.bankCardNumber), id)
        : null;
      const createdAt = validDate(source.createdAt) ?? new Date().toISOString();
      const updatedAt = validDate(source.updatedAt) ?? createdAt;
      const nextFollowUpAt = source.nextFollowUpAt ? validDate(source.nextFollowUpAt) : null;
      const machineType = isCustomerMachineType(source.machineType) ? source.machineType : null;
      const machineMode = machineType && isCustomerMachineMode(source.machineMode) ? source.machineMode : null;
      const feeRate = machineType && machineMode && isValidCustomerFeeRate(source.feeRate)
        ? source.feeRate
        : null;
      const depositAmount = machineType
        ? normalizeMachineDeposit(source.depositAmount)
        : null;
      const address = normalizeCustomerAddress(source.address);
      const tags = normalizeCustomerTags(source.tags);
      await db.batch([
        db
          .prepare(
            `INSERT INTO customers (
              id, owner_id, name, phone, shop_name, category,
              machine_type, machine_mode, fee_rate,
              deposit_amount, address, tags_json,
              id_card_front_key, id_card_back_key, business_license_key,
              bank_card_ciphertext, bank_card_last4,
              next_follow_up_at, deleted_at, purge_after,
              created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, NULL, NULL, ?19, ?20)`,
          )
          .bind(
            id,
            userId,
            name,
            phone,
            typeof source.shopName === "string" ? source.shopName.trim().slice(0, 120) || null : null,
            normalizeCustomerCategory(source.category),
            machineType,
            machineMode,
            feeRate,
            depositAmount,
            address,
            JSON.stringify(tags),
            frontKey,
            backKey,
            businessLicenseKey,
            encryptedCard?.ciphertext ?? null,
            encryptedCard?.last4 ?? null,
            nextFollowUpAt,
            createdAt,
            updatedAt,
          ),
        activityStatement(db, {
          ownerId: userId,
          customerId: id,
          customerName: name,
          eventType: "customer_restored_from_backup",
          summary: "客户已从备份文件恢复",
        }),
      ]);
      imported += 1;
    } catch {
      await Promise.allSettled(uploaded.map((key) => files.delete(key)));
      skipped += 1;
    }
  }
  return privateJson({ imported, skipped });
}

async function readImage(files: R2Bucket, key: string | null): Promise<BackupImage> {
  if (!key) return null;
  const object = await files.get(key);
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  return {
    contentType: headers.get("content-type") ?? "image/jpeg",
    base64: bytesToBase64(bytes),
  };
}

function decodeImage(value: BackupImage): { contentType: string; bytes: Uint8Array } | null {
  if (!value || !SAFE_IMAGE_TYPES.has(value.contentType) || typeof value.base64 !== "string") return null;
  try {
    const binary = atob(value.base64);
    if (binary.length > 10 * 1024 * 1024) return null;
    return {
      contentType: value.contentType,
      bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    };
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(value);
}

function normalizePhone(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return `${trimmed.startsWith("+") ? "+" : ""}${trimmed.replace(/\D/g, "")}`;
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
