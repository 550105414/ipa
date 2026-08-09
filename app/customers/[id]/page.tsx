import type { Metadata } from "next";
import { CustomerDetailClient } from "./CustomerDetailClient";

export const metadata: Metadata = {
  title: "客户详情｜销售工作台",
  description: "查看客户资料与完整状态。",
};

type CustomerDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function CustomerDetailPage({
  params,
}: CustomerDetailPageProps) {
  const { id } = await params;
  return <CustomerDetailClient key={id} customerId={id} />;
}
