import type { CustomerMachineMode, CustomerMachineType } from "@/lib/customers/machine";
import type { CustomerStage, MachineStatus } from "@/lib/customers/profile";

export type ProfileStatus = "completed" | "draft";
export type CustomerCategory = "直营" | "代理" | "汇来米" | "收银通";

export type CustomerSearchItem = {
  kind: "customer";
  id: string;
  name: string;
  shopName?: string | null;
  maskedPhone: string;
  profileStatus: ProfileStatus;
  category?: CustomerCategory;
  stage?: CustomerStage;
  nextFollowUpAt?: string | null;
  machineType?: CustomerMachineType | null;
  machineMode?: CustomerMachineMode | null;
  feeRate?: number | null;
  depositAmount?: number | null;
  machineSerial?: string | null;
  machineStatus?: MachineStatus | null;
  installedAt?: string | null;
  monthlyVolume?: number | null;
  profitShareRate?: number | null;
  address?: string | null;
  tags?: string[];
  createdAt: string | null;
};

export type CustomerSearchResponse = {
  items: CustomerSearchItem[];
  nextCursor: string | null;
  total?: number;
  demoMode?: boolean;
};

export type CustomerDetail = {
  id: string;
  name: string;
  shopName?: string | null;
  maskedPhone: string;
  profileStatus: ProfileStatus;
  category?: CustomerCategory;
  stage?: CustomerStage;
  nextFollowUpAt?: string | null;
  machineType?: CustomerMachineType | null;
  machineMode?: CustomerMachineMode | null;
  feeRate?: number | null;
  depositAmount?: number | null;
  machineSerial?: string | null;
  machineStatus?: MachineStatus | null;
  installedAt?: string | null;
  monthlyVolume?: number | null;
  profitShareRate?: number | null;
  address?: string | null;
  tags?: string[];
  createdAt: string | null;
  idCard: {
    frontUploaded: boolean;
    backUploaded: boolean;
  };
  businessLicense?: { uploaded: boolean };
  merchantName?: string | null;
  notes?: string | null;
};

export type CustomerDetailResponse = {
  customer: CustomerDetail;
  demoMode?: boolean;
};

export type CustomerSensitiveData = {
  phone: string;
  idCard: {
    frontUrl: string | null;
    backUrl: string | null;
  };
  bankCardNumber: string | null;
  businessLicenseUrl?: string | null;
  demoMode?: boolean;
};

export type BankCardUpdateResponse = {
  last4: string;
};
