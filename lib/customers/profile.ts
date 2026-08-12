export const CUSTOMER_CALL_RESULTS = ["已联系", "未接", "待回访", "已成交"] as const;
export const CUSTOMER_STAGES = ["新客户", "沟通中", "待进件", "已进件", "已商户", "已流失"] as const;
export const MACHINE_STATUSES = ["待安装", "已安装", "已回收"] as const;

export type CustomerCallResult = (typeof CUSTOMER_CALL_RESULTS)[number];
export type CustomerStage = (typeof CUSTOMER_STAGES)[number];
export type MachineStatus = (typeof MACHINE_STATUSES)[number];

export const MAX_CUSTOMER_TAGS = 8;
export const MAX_CUSTOMER_TAG_LENGTH = 20;
export const MAX_CUSTOMER_ADDRESS_LENGTH = 200;
export const MAX_MACHINE_DEPOSIT = 1_000_000;

export function isCustomerCallResult(value: unknown): value is CustomerCallResult {
  return CUSTOMER_CALL_RESULTS.includes(value as CustomerCallResult);
}

export function isCustomerStage(value: unknown): value is CustomerStage {
  return CUSTOMER_STAGES.includes(value as CustomerStage);
}

export function isMachineStatus(value: unknown): value is MachineStatus {
  return MACHINE_STATUSES.includes(value as MachineStatus);
}

export function normalizeNonNegativeMoney(value: unknown, maximum = 100_000_000): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > maximum) {
    throw new Error("INVALID_MONEY");
  }
  return Math.round(amount * 100) / 100;
}

export function normalizePercentage(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const percentage = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("INVALID_PERCENTAGE");
  }
  return Math.round(percentage * 10_000) / 10_000;
}

export function normalizeCustomerAddress(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("INVALID_CUSTOMER_ADDRESS");
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_CUSTOMER_ADDRESS_LENGTH) {
    throw new Error("INVALID_CUSTOMER_ADDRESS");
  }
  return normalized;
}

export function normalizeCustomerTags(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[，,]/)
      : value === null || value === undefined
        ? []
        : (() => {
            throw new Error("INVALID_CUSTOMER_TAGS");
          })();
  const normalized = Array.from(
    new Set(
      values.map((item) => {
        if (typeof item !== "string") throw new Error("INVALID_CUSTOMER_TAGS");
        return item.trim();
      }),
    ),
  ).filter(Boolean);
  if (
    normalized.length > MAX_CUSTOMER_TAGS ||
    normalized.some((tag) => tag.length > MAX_CUSTOMER_TAG_LENGTH)
  ) {
    throw new Error("INVALID_CUSTOMER_TAGS");
  }
  return normalized;
}

export function parseStoredCustomerTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    return normalizeCustomerTags(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

export function normalizeMachineDeposit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_MACHINE_DEPOSIT) {
    throw new Error("INVALID_MACHINE_DEPOSIT");
  }
  return Math.round(amount * 100) / 100;
}
