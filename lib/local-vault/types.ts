import type { CustomerMachineMode, CustomerMachineType } from "@/lib/customers/machine";

export type LocalCustomerProfileStatus = "completed" | "draft";

export const LOCAL_CUSTOMER_CATEGORIES = ["直营", "代理", "汇来米", "收银通"] as const;

export type LocalCustomerCategory = (typeof LOCAL_CUSTOMER_CATEGORIES)[number];

export type LocalCustomerSummary = {
  id: string;
  name: string;
  shopName?: string | null;
  maskedPhone: string;
  profileStatus: LocalCustomerProfileStatus;
  category: LocalCustomerCategory;
  machineType?: CustomerMachineType | null;
  machineMode?: CustomerMachineMode | null;
  feeRate?: number | null;
  depositAmount?: number | null;
  address?: string | null;
  tags?: string[];
  createdAt: string;
  idCard: {
    frontUploaded: boolean;
    backUploaded: boolean;
  };
  hasBankCard: boolean;
  businessLicense: { uploaded: boolean };
};

export type SaveLocalCustomerInput = {
  id?: string;
  name: string;
  shopName?: string | null;
  phone: string;
  idCardFront?: Blob | null;
  idCardBack?: Blob | null;
  businessLicense?: Blob | null;
  bankCardNumber?: string | null;
  category?: LocalCustomerCategory;
  machineType?: CustomerMachineType | null;
  machineMode?: CustomerMachineMode | null;
  feeRate?: number | null;
  depositAmount?: number | null;
  address?: string | null;
  tags?: string[];
  status?: LocalCustomerProfileStatus;
  createdAt?: string;
};

export type LocalCustomerSearchFilters = {
  status?: "all" | LocalCustomerProfileStatus;
  period?: "all" | "this_month" | "last_month";
  category?: "all" | LocalCustomerCategory;
  limit?: number;
};

export type LocalVaultScope = { userScope: string };

export type LocalVaultPageScope = LocalVaultScope & {
  cursor?: string | null;
};

export type LocalCustomerSearchPage = {
  items: LocalCustomerSummary[];
  nextCursor: string | null;
  total: number;
};

export type LocalCustomerAccess = LocalCustomerSummary & {
  phone: string;
  bankCardNumber: string | null;
  idCard: LocalCustomerSummary["idCard"] & {
    frontBlob: Blob | null;
    backBlob: Blob | null;
    frontUrl: string | null;
    backUrl: string | null;
  };
  businessLicense: LocalCustomerSummary["businessLicense"] & {
    blob: Blob | null;
    url: string | null;
  };
  revoke(): void;
};

export type LocalVaultSession = Readonly<{
  userScope: string;
  expiresAt: number;
}>;

export type LocalVaultSessionLifecycleOptions = {
  onExpired?: () => void;
  windowTarget?: Pick<Window, "addEventListener" | "removeEventListener">;
  documentTarget?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
};
