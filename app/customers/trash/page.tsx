import type { Metadata } from "next";
import { TrashClient } from "./TrashClient";

export const metadata: Metadata = { title: "客户回收站｜销售工作台" };

export default function TrashPage() {
  return <TrashClient />;
}
