import type { SearchParams } from "@/lib/search/params";
import type {
  CustomerSensitiveResponse,
  CustomerDetail,
  CustomerSearchItem,
  MerchantSearchItem,
  ProfileStatus,
  SearchItem,
} from "@/lib/search/types";

interface DemoCustomer extends CustomerDetail {
  sourcePhone: string;
}

const CUSTOMER_IDS = {
  chenZhiqiang: "06789e3a-bbe8-4ed4-a7a5-7f395be0a58c",
  chenZhiming: "b3551449-8307-4388-a2c0-00817495229b",
  chenLaoban: "6a769627-c720-4b44-af31-d8b27c35951c",
} as const;

export function searchDemo(
  params: SearchParams,
  fetchLimit: number,
): SearchItem[] {
  const query = params.query.toLocaleLowerCase("zh-CN");
  const now = new Date();
  const customers = demoCustomers(now)
    .filter((customer) => matchesCustomer(customer, query))
    .filter((customer) =>
      params.status === "all"
        ? true
        : customer.profileStatus === params.status,
    )
    .filter((customer) => matchesPeriod(customer.createdAt, params.period))
    .map<CustomerSearchItem>((customer) => ({
      kind: "customer",
      id: customer.id,
      name: customer.name,
      maskedPhone: maskPhone(customer.sourcePhone),
      profileStatus: customer.profileStatus,
      createdAt: customer.createdAt,
    }));

  const merchants =
    params.scope === "all" && query !== ""
      ? demoMerchants(now).filter((merchant) =>
          [
            merchant.merchantName,
            merchant.merchantNo,
            merchant.terminalNo,
          ].some((value) => value?.toLocaleLowerCase("zh-CN").includes(query)),
        )
      : [];

  const visibleCustomers =
    params.scope === "customers" || query !== "" ? customers : [];

  return [...visibleCustomers, ...merchants]
    .sort((left, right) => {
      const scoreDelta =
        demoRelevance(right, query) - demoRelevance(left, query);
      if (scoreDelta !== 0) return scoreDelta;
      return (right.createdAt ?? "").localeCompare(left.createdAt ?? "");
    })
    .slice(params.offset, params.offset + fetchLimit);
}

export function getDemoCustomer(id: string): CustomerDetail | null {
  const customer = demoCustomers(new Date()).find((item) => item.id === id);
  if (!customer) return null;

  return {
    id: customer.id,
    name: customer.name,
    maskedPhone: customer.maskedPhone,
    profileStatus: customer.profileStatus,
    createdAt: customer.createdAt,
    idCard: customer.idCard,
  };
}

export function getDemoSensitiveCustomer(
  id: string,
): Omit<CustomerSensitiveResponse, "demoMode"> | null {
  const customer = demoCustomers(new Date()).find((item) => item.id === id);
  if (!customer) return null;

  return {
    phone: customer.sourcePhone,
    idCard: {
      // Demo mode never pretends that a real identity image is available.
      frontUrl: null,
      backUrl: null,
    },
    // 4111… is a well-known non-production Luhn test number. It is returned
    // only together with `demoMode: true` by the API.
    bankCardNumber:
      customer.id === CUSTOMER_IDS.chenZhiqiang ? "4111111111111111" : null,
  };
}

function demoCustomers(now: Date): DemoCustomer[] {
  if (!demoSeedEnabled()) return [];
  return [
    makeCustomer(
      CUSTOMER_IDS.chenZhiqiang,
      "陈志强",
      "13800138888",
      true,
      true,
      daysAgo(now, 0, 10, 30),
    ),
    makeCustomer(
      CUSTOMER_IDS.chenZhiming,
      "陈志明",
      "13922161234",
      true,
      false,
      daysAgo(now, 4, 15, 20),
    ),
    makeCustomer(
      CUSTOMER_IDS.chenLaoban,
      "陈老板",
      "18688886666",
      true,
      true,
      daysAgo(now, 35, 9, 5),
    ),
  ];
}

function demoMerchants(now: Date): MerchantSearchItem[] {
  if (!demoSeedEnabled()) return [];
  return [
    {
      kind: "merchant",
      id: "2b1458e0-eb22-4f1b-a6ec-02754bab49aa",
      merchantName: "广州第一螺",
      merchantNo: "M12345678",
      terminalNo: "12345678",
      merchantStatus: "正常",
      createdAt: daysAgo(now, 2, 11, 15),
    },
    {
      kind: "merchant",
      id: "e1b21f27-c588-42f4-ac5b-46fabf38e13f",
      merchantName: "广州星河餐饮店",
      merchantNo: "M20260809002",
      terminalNo: "T66001888",
      merchantStatus: "正常",
      createdAt: daysAgo(now, 12, 14, 10),
    },
  ];
}

function demoSeedEnabled(): boolean {
  return process.env.SEARCH_DEMO_SEED?.trim().toLowerCase() === "true";
}

function makeCustomer(
  id: string,
  name: string,
  phone: string,
  frontUploaded: boolean,
  backUploaded: boolean,
  createdAt: string,
): DemoCustomer {
  const profileStatus: ProfileStatus =
    name.trim() && phone.trim() && frontUploaded && backUploaded
      ? "completed"
      : "draft";
  return {
    id,
    name,
    maskedPhone: maskPhone(phone),
    sourcePhone: phone,
    profileStatus,
    createdAt,
    idCard: { frontUploaded, backUploaded },
  };
}

function matchesCustomer(customer: DemoCustomer, query: string): boolean {
  if (query === "") return true;
  return (
    customer.name.toLocaleLowerCase("zh-CN").includes(query) ||
    customer.sourcePhone.includes(query)
  );
}

function matchesPeriod(
  createdAt: string | null,
  period: SearchParams["period"],
): boolean {
  if (period === "all") return true;
  if (!createdAt) return false;

  const createdMonth = shanghaiMonth(new Date(createdAt));
  const currentMonth = shanghaiMonth(new Date());
  if (period === "this_month") return createdMonth === currentMonth;

  const now = new Date();
  const previousMonthDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
  );
  return createdMonth === shanghaiMonth(previousMonthDate);
}

function shanghaiMonth(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).format(date);
}

function demoRelevance(item: SearchItem, query: string): number {
  if (!query) return 0;
  const values =
    item.kind === "customer"
      ? [item.name, item.maskedPhone]
      : [item.merchantName, item.merchantNo ?? "", item.terminalNo ?? ""];
  if (values.some((value) => value.toLocaleLowerCase("zh-CN") === query)) {
    return 100;
  }
  if (
    values.some((value) => value.toLocaleLowerCase("zh-CN").startsWith(query))
  ) {
    return 80;
  }
  return 50;
}

function maskPhone(phone: string): string {
  if (phone.length < 7) return `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function daysAgo(date: Date, days: number, hours: number, minutes: number): string {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() - days);
  value.setUTCHours(hours, minutes, 0, 0);
  return value.toISOString();
}
