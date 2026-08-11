export type CustomerCategory = '直营' | '代理' | '汇来米' | '收银通';
export type MachineType = '音响' | '扫码王' | '收银机';
export type MachineMode = '购买' | '赠送';

export type CustomerSummary = {
  kind: 'customer';
  id: string;
  name: string;
  shopName?: string | null;
  maskedPhone: string;
  profileStatus: 'completed' | 'draft';
  category?: CustomerCategory;
  nextFollowUpAt?: string | null;
  machineType?: MachineType | null;
  machineMode?: MachineMode | null;
  feeRate?: number | null;
  depositAmount?: number | null;
  createdAt: string | null;
};

export type CustomerDetail = Omit<CustomerSummary, 'kind'> & {
  address?: string | null;
  tags?: string[];
  idCard: {
    frontUploaded: boolean;
    backUploaded: boolean;
  };
  businessLicense?: { uploaded: boolean };
};

export type CustomerSensitive = {
  phone: string;
  bankCardNumber: string | null;
  idCard: {
    frontUrl: string | null;
    backUrl: string | null;
  };
  businessLicenseUrl?: string | null;
};

export type SearchResponse = {
  items: CustomerSummary[];
  nextCursor: string | null;
  total?: number;
};

export type TrashedCustomer = {
  id: string;
  name: string;
  shopName?: string | null;
  maskedPhone: string;
  category: CustomerCategory;
  deletedAt: string;
  purgeAfter: string;
};
