"use client";

import { ArchiveRestore, ChevronLeft, Trash2 } from "lucide-react";
import { type ComponentPropsWithoutRef, useCallback, useEffect, useState } from "react";
import { customerRequestHeaders } from "../request";

type TrashItem = {
  id: string;
  name: string;
  shopName: string | null;
  maskedPhone: string;
  category: string;
  deletedAt: string;
  purgeAfter: string;
};

function Link({ children, ...props }: ComponentPropsWithoutRef<"a">) {
  return <a {...props}>{children}</a>;
}

export function TrashClient() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/customers/trash", { headers: customerRequestHeaders(), cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { items?: TrashItem[] };
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } catch {
      setMessage("回收站暂时无法读取，请稍后刷新。 ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  async function restore(item: TrashItem) {
    setWorkingId(item.id);
    setMessage(null);
    const response = await fetch(`/api/customers/${item.id}/restore`, { method: "POST", headers: customerRequestHeaders() });
    if (response.ok) {
      setItems((current) => current.filter((value) => value.id !== item.id));
      setMessage(`已恢复客户“${item.name}”。`);
    } else setMessage("恢复失败，请稍后重试。 ");
    setWorkingId(null);
  }

  async function remove(item: TrashItem) {
    if (!window.confirm(`确定彻底删除“${item.name}”吗？此操作无法恢复。`)) return;
    setWorkingId(item.id);
    setMessage(null);
    const response = await fetch(`/api/customers/${item.id}/permanent`, { method: "DELETE", headers: customerRequestHeaders() });
    if (response.ok) {
      setItems((current) => current.filter((value) => value.id !== item.id));
      setMessage(`已彻底删除客户“${item.name}”。`);
    } else setMessage("彻底删除失败，请稍后重试。 ");
    setWorkingId(null);
  }

  return (
    <div className="min-h-screen bg-[#f3f6fb] text-[#172033]">
      <header className="border-b border-[#e7ecf5] bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/customers" className="inline-flex items-center gap-2 text-sm font-semibold text-[#526071]"><ChevronLeft size={18} />返回客户列表</Link>
          <span className="rounded-full bg-[#fff1ef] px-3 py-1.5 text-xs font-semibold text-[#a23d32]">保留 30 天</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-7 sm:px-6">
        <div className="mb-6"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#a23d32]">Recycle bin</p><h1 className="mt-2 text-2xl font-semibold">客户回收站</h1><p className="mt-2 text-sm text-[#667085]">删除的客户会保留 30 天，到期后自动彻底清除。</p></div>
        {message && <p role="status" className="mb-4 rounded-xl border border-[#d9e4fb] bg-white px-4 py-3 text-sm text-[#526071]">{message}</p>}
        {loading ? <div className="h-32 animate-pulse rounded-2xl bg-white" /> : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#d9e2f0] bg-white py-16 text-center"><Trash2 className="mx-auto text-[#9aa8bd]" /><h2 className="mt-3 font-semibold">回收站为空</h2><p className="mt-1 text-sm text-[#7a8699]">暂无已删除客户。</p></div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => <article key={item.id} className="flex flex-col gap-4 rounded-2xl border border-[#e7ecf5] bg-white p-4 shadow-sm sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{item.name}</h2><span className="rounded-full bg-[#f1ecff] px-2 py-0.5 text-xs font-semibold text-[#6d4bc3]">{item.category}</span></div>{item.shopName && <p className="mt-1 text-sm font-medium text-[#526071]">店铺：{item.shopName}</p>}<p className="mt-1 font-mono text-sm text-[#667085]">{item.maskedPhone}</p><p className="mt-2 text-xs text-[#8a95a6]">将在 {formatDate(item.purgeAfter)} 自动清除</p></div>
              <div className="flex gap-2"><button type="button" disabled={workingId === item.id} onClick={() => void restore(item)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#2f6bff] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><ArchiveRestore size={16} />恢复</button><button type="button" disabled={workingId === item.id} onClick={() => void remove(item)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#efc9c4] px-4 py-2.5 text-sm font-semibold text-[#a23d32] disabled:opacity-50"><Trash2 size={16} />彻底删除</button></div>
            </article>)}
          </div>
        )}
      </main>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
