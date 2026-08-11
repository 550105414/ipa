export const CUSTOMER_CALL_RESULTS = ["已联系", "未接", "待回访", "已成交"] as const;

export type CustomerCallResult = (typeof CUSTOMER_CALL_RESULTS)[number];

export const MAX_CUSTOMER_TAGS = 8;
export const MAX_CUSTOMER_TAG_LENGTH = 20;
export const MAX_CUSTOMER_ADDRESS_LENGTH = 200;
export const MAX_MACHINE_DEPOSIT = 1_000_000;

export function isCustomerCallResult(value: unknown): value is CustomerCallResult {
  return CUSTOMER_CALL_RESULTS.includes(value as CustomerCallResult);
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
