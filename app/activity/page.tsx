import type { Metadata } from "next";
import { ActivityClient } from "./ActivityClient";

export const metadata: Metadata = { title: "操作记录｜销售工作台" };
export default function ActivityPage() { return <ActivityClient />; }
