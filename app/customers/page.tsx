import type { Metadata } from "next";
import { CustomersClient } from "./CustomersClient";

export const metadata: Metadata = {
  title: "客户｜销售工作台",
  description: "按姓名、手机号、店铺名字、资料状态和录入时间快速查找客户。",
};

type CustomersPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CustomersPage({
  searchParams,
}: CustomersPageProps) {
  const params = searchParams ? await searchParams : {};
  const requestedStatus = Array.isArray(params.status)
    ? params.status[0]
    : params.status;
  const initialStatus =
    requestedStatus === "completed" || requestedStatus === "draft"
      ? requestedStatus
      : "all";

  return <CustomersClient initialStatus={initialStatus} />;
}
