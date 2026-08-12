export type CustomerCategory = '直营' | '代理' | '汇来米' | '收银通';
export type MachineType = '音响' | '扫码王' | '收银机';
export type MachineMode = '购买' | '赠送';
export type CustomerStage = '新客户' | '沟通中' | '待进件' | '已进件' | '已商户' | '已流失';
export type MachineStatus = '待安装' | '已安装' | '已回收';

export type CustomerSummary = {
  kind: 'customer';
  id: string;
  name: string;
  shopName?: string | null;
  maskedPhone: string;
  profileStatus: 'completed' | 'draft';
  category?: CustomerCategory;
  stage?: CustomerStage;
  nextFollowUpAt?: string | null;
  machineType?: MachineType | null;
  machineMode?: MachineMode | null;
  feeRate?: number | null;
  depositAmount?: number | null;
  machineSerial?: string | null;
  machineStatus?: MachineStatus | null;
  installedAt?: string | null;
  monthlyVolume?: number | null;
  profitShareRate?: number | null;
  createdAt: string | null;
};

export type CustomerActivity = {
  id: string;
  eventType: string;
  summary: string;
  createdAt: string;
};

export type WorkspaceDashboard = {
  totals: { customers: number; complete: number; draft: number; merchants: number };
  followUps: { totalDue: number; overdue: number; items: { id: string; name: string; maskedPhone: string; nextFollowUpAt: string; overdue: boolean }[] };
  stages: { stage: CustomerStage; count: number }[];
  health: { total: number; issues: { id: string; name: string; issues: string[] }[] };
  earnings: { monthlyVolume: number; estimatedProfit: number; activeMachines: number };
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
