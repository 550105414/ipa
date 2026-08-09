import type { Metadata } from "next";
import { DataSettingsClient } from "./DataSettingsClient";

export const metadata: Metadata = { title: "备份与恢复｜销售工作台" };
export default function DataSettingsPage() { return <DataSettingsClient />; }
