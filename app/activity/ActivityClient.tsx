"use client";

import { ChevronLeft, History } from "lucide-react";
import { type ComponentPropsWithoutRef, useEffect, useState } from "react";
import { customerRequestHeaders } from "@/app/customers/request";

type Activity = { id: string; customer_id: string | null; customer_name: string; event_type: string; summary: string; created_at: string };

function Link({ children, ...props }: ComponentPropsWithoutRef<"a">) { return <a {...props}>{children}</a>; }

export function ActivityClient() {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/activity", { headers: customerRequestHeaders(), cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? (await response.json()) as { items?: Activity[] } : { items: [] })
      .then((payload) => setItems(payload.items ?? []))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  return <div className="min-h-screen bg-[#f3f6fb] text-[#172033]">
    <header className="border-b border-[#e7ecf5] bg-white"><div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6"><Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#526071]"><ChevronLeft size={18} />返回工作台</Link></div></header>
    <main className="mx-auto max-w-5xl px-4 py-7 sm:px-6"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2f6bff]">Activity log</p><h1 className="mt-2 text-2xl font-semibold">操作记录</h1><p className="mt-2 text-sm text-[#667085]">记录客户新增、修改、删除、恢复与资料补充时间。</p>
      <section className="mt-6 overflow-hidden rounded-2xl border border-[#e7ecf5] bg-white shadow-sm">{loading ? <div className="h-40 animate-pulse bg-[#f8faff]" /> : items.length === 0 ? <div className="py-16 text-center"><History className="mx-auto text-[#9aa8bd]" /><p className="mt-3 text-sm text-[#667085]">暂无操作记录</p></div> : <div className="divide-y divide-[#edf1f7]">{items.map((item) => <article key={item.id} className="grid gap-2 px-4 py-4 sm:grid-cols-[160px_150px_1fr] sm:items-center sm:px-5"><time className="text-xs text-[#8a95a6]">{formatDate(item.created_at)}</time><div className="font-semibold text-[#344054]">{item.customer_id ? <Link className="text-[#2f6bff]" href={`/customers/${item.customer_id}`}>{item.customer_name}</Link> : item.customer_name}</div><p className="text-sm text-[#667085]">{item.summary}</p></article>)}</div>}</section>
    </main>
  </div>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
