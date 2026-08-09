import type { Metadata } from "next";
import { NewCustomerClient } from "./NewCustomerClient";

export const metadata: Metadata = {
  title: "新增客户｜销售工作台",
  description: "快速录入客户姓名、手机号、店铺名字和身份证正反面资料。",
};

export default function NewCustomerPage() {
  return <NewCustomerClient />;
}
