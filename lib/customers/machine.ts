export const CUSTOMER_MACHINE_TYPES = ["音响", "扫码王", "收银机"] as const;
export const CUSTOMER_MACHINE_MODES = ["购买", "赠送"] as const;

export type CustomerMachineType = (typeof CUSTOMER_MACHINE_TYPES)[number];
export type CustomerMachineMode = (typeof CUSTOMER_MACHINE_MODES)[number];

export function isCustomerMachineType(value: unknown): value is CustomerMachineType {
  return CUSTOMER_MACHINE_TYPES.includes(value as CustomerMachineType);
}

export function isCustomerMachineMode(value: unknown): value is CustomerMachineMode {
  return CUSTOMER_MACHINE_MODES.includes(value as CustomerMachineMode);
}

export function isValidCustomerFeeRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100;
}
