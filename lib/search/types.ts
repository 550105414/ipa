export type SearchScope = "all" | "customers";

import type { CustomerMachineMode, CustomerMachineType } from "@/lib/customers/machine";

export type ProfileStatus = "completed" | "draft";

export type SearchPeriod = "all" | "this_month" | "last_month";
export type CustomerCategory = "直营" | "代理" | "汇来米" | "收银通";

export interface CustomerSearchItem {
  kind: "customer";
  id: string;
  name: string;
  shopName?: string | null;
  maskedPhone: string;
  profileStatus: ProfileStatus;
  category?: CustomerCategory;
  nextFollowUpAt?: string | null;
  machineType?: CustomerMachineType | null;
  machineMode?: CustomerMachineMode | null;
  feeRate?: number | null;
  createdAt: string | null;
}

export interface MerchantSearchItem {
  kind: "merchant";
  id: string;
  merchantName: string;
  merchantNo: string | null;
  terminalNo: string | null;
  merchantStatus: string | null;
  createdAt: string | null;
}

export type SearchItem = CustomerSearchItem | MerchantSearchItem;

export interface SearchResponse {
  items: SearchItem[];
  nextCursor: string | null;
  total?: number;
  demoMode?: boolean;
}

export interface CustomerDetail {
  id: string;
  name: string;
  shopName?: string | null;
  maskedPhone: string;
  profileStatus: ProfileStatus;
  category?: CustomerCategory;
  nextFollowUpAt?: string | null;
  machineType?: CustomerMachineType | null;
  machineMode?: CustomerMachineMode | null;
  feeRate?: number | null;
  createdAt: string | null;
  idCard: {
    frontUploaded: boolean;
    backUploaded: boolean;
  };
}

export interface CustomerDetailResponse {
  customer: CustomerDetail;
  demoMode?: boolean;
}

export interface CustomerPhoneResponse {
  customerId: string;
  phone: string;
  demoMode?: boolean;
}

export interface CustomerSensitiveResponse {
  phone: string;
  idCard: {
    frontUrl: string | null;
    backUrl: string | null;
  };
  bankCardNumber: string | null;
  demoMode?: boolean;
}

export interface BankCardUpdateResponse {
  last4: string;
  demoMode?: boolean;
}

export interface CustomerCreateResponse {
  id: string;
  demoMode?: boolean;
  warning?: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
