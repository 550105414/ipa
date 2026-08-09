"use client";

import { type ComponentPropsWithoutRef, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, Check, ChevronLeft, Clock3, Plus, RotateCcw, Trash2, UserRound } from "lucide-react";
import type { CustomerSearchResponse } from "@/app/customers/types";
import { customerRequestHeaders } from "@/app/customers/request";

type Task = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  title: string;
  due_at: string | null;
  status: "open" | "done";
  created_at: string;
  completed_at: string | null;
};

type CustomerOption = { id: string; name: string };

function Link({ children, ...props }: ComponentPropsWithoutRef<"a">) {
  return <a {...props}>{children}</a>;
}

export function TasksClient() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    setError(null);
    try {
      const [taskResponse, customerResponse] = await Promise.all([
        fetch("/api/tasks", { headers: customerRequestHeaders(), cache: "no-store" }),
        fetch("/api/search", {
          method: "POST",
          headers: customerRequestHeaders(true),
          body: JSON.stringify({ q: "", scope: "customers", status: "all", period: "all", category: "all", limit: 20 }),
          cache: "no-store",
        }),
      ]);
      if (!taskResponse.ok) throw new Error("待办读取失败");
      const taskPayload = (await taskResponse.json()) as { items?: Task[] };
      setTasks(Array.isArray(taskPayload.items) ? taskPayload.items : []);
      if (customerResponse.ok) {
        const payload = (await customerResponse.json()) as CustomerSearchResponse;
        setCustomers(
          payload.items
            .filter((item) => item.kind === "customer")
            .map((item) => ({ id: item.id, name: item.name })),
        );
      }
    } catch {
      setError("暂时无法读取待办，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const visibleTasks = useMemo(
    () => tasks.filter((task) => showDone || task.status === "open"),
    [showDone, tasks],
  );
  const openCount = tasks.filter((task) => task.status === "open").length;

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: customerRequestHeaders(true),
        body: JSON.stringify({
          title: title.trim(),
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          customerId: customerId || null,
        }),
      });
      if (!response.ok) throw new Error("save failed");
      setTitle("");
      setDueAt("");
      setCustomerId("");
      await load();
    } catch {
      setError("待办保存失败，请检查内容后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(task: Task) {
    const status = task.status === "open" ? "done" : "open";
    const response = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: customerRequestHeaders(true),
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      setError("待办状态更新失败，请重试。");
      return;
    }
    await load();
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`确定删除待办“${task.title}”吗？`)) return;
    const response = await fetch(`/api/tasks/${task.id}`, {
      method: "DELETE",
      headers: customerRequestHeaders(),
    });
    if (!response.ok) {
      setError("待办删除失败，请重试。");
      return;
    }
    setTasks((current) => current.filter((item) => item.id !== task.id));
  }

  return (
    <div className="min-h-screen bg-[#f3f6fb] text-[#172033]">
      <header className="border-b border-[#e7ecf5] bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#526071]">
            <ChevronLeft size={18} /> 返回工作台
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full bg-[#eaf1ff] px-3 py-1.5 text-xs font-semibold text-[#2859d9]">
            <CalendarCheck2 size={15} /> 云端同步待办
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-9">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2f6bff]">Follow-up</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">客户待办</h1>
            <p className="mt-2 text-sm text-[#667085]">手机新增，电脑自动同步。当前有 {openCount} 项未完成。</p>
          </div>
          <label className="inline-flex items-center gap-2 rounded-xl border border-[#d9e2f0] bg-white px-4 py-2.5 text-sm font-medium text-[#526071]">
            <input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
            显示已完成
          </label>
        </div>

        <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <form onSubmit={createTask} className="h-fit rounded-2xl border border-[#e1e8f2] bg-white p-5 shadow-sm lg:sticky lg:top-5">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-[#2f6bff] text-white"><Plus size={20} /></span>
              <div><h2 className="font-semibold">新增待办</h2><p className="text-xs text-[#7a8699]">可关联到具体客户</p></div>
            </div>
            <label className="mt-5 block text-xs font-semibold text-[#5f6b7a]">待办内容
              <textarea value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} rows={3} placeholder="例如：回访客户并确认资料" className="mt-2 w-full resize-none rounded-xl border border-[#d9e2f0] bg-[#f8faff] p-3 text-sm outline-none focus:border-[#2f6bff] focus:bg-white focus:ring-4 focus:ring-[#2f6bff]/10" />
            </label>
            <label className="mt-4 block text-xs font-semibold text-[#5f6b7a]">关联客户（可选）
              <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d9e2f0] bg-white px-3 text-sm outline-none focus:border-[#2f6bff]">
                <option value="">不关联客户</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
              </select>
            </label>
            <label className="mt-4 block text-xs font-semibold text-[#5f6b7a]">计划时间（可选）
              <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d9e2f0] bg-white px-3 text-sm outline-none focus:border-[#2f6bff]" />
            </label>
            <button type="submit" disabled={!title.trim() || saving} className="mt-5 h-12 w-full rounded-xl bg-[#2f6bff] text-sm font-semibold text-white shadow-sm disabled:opacity-50">
              {saving ? "正在保存…" : "保存待办"}
            </button>
          </form>

          <section className="rounded-2xl border border-[#e1e8f2] bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between border-b border-[#edf1f7] pb-4">
              <div><h2 className="font-semibold">待办列表</h2><p className="mt-1 text-xs text-[#7a8699]">按未完成、计划时间排序</p></div>
              <button type="button" onClick={() => void load()} className="rounded-lg border border-[#d9e2f0] p-2 text-[#526071]" aria-label="刷新待办"><RotateCcw size={17} /></button>
            </div>
            {error && <p role="alert" className="mt-4 rounded-xl bg-[#fff3ec] px-4 py-3 text-sm text-[#99502f]">{error}</p>}
            {loading ? (
              <div className="space-y-3 py-5">{[1,2,3].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-[#f3f6fb]" />)}</div>
            ) : visibleTasks.length === 0 ? (
              <div className="grid min-h-64 place-items-center text-center"><div><CalendarCheck2 className="mx-auto text-[#9aa8bd]" size={34} /><h3 className="mt-3 font-semibold">暂无待办</h3><p className="mt-1 text-sm text-[#7a8699]">新增第一条客户跟进事项吧。</p></div></div>
            ) : (
              <div className="divide-y divide-[#edf1f7]">
                {visibleTasks.map((task) => (
                  <article key={task.id} className="flex items-start gap-3 py-4">
                    <button type="button" onClick={() => void updateStatus(task)} aria-label={task.status === "open" ? "标记完成" : "恢复待办"} className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border ${task.status === "done" ? "border-[#66b99a] bg-[#e9f8f1] text-[#27805f]" : "border-[#cbd6e8] bg-white text-[#7a8699]"}`}>
                      {task.status === "done" ? <Check size={16} /> : <Clock3 size={15} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold leading-6 ${task.status === "done" ? "text-[#8a95a6] line-through" : "text-[#263247]"}`}>{task.title}</p>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#7a8699]">
                        {task.customer_name && <Link href={`/customers/${task.customer_id}`} className="inline-flex items-center gap-1 text-[#2f6bff]"><UserRound size={13} />{task.customer_name}</Link>}
                        <span>{task.due_at ? `计划 ${formatDate(task.due_at)}` : "未设置计划时间"}</span>
                      </div>
                    </div>
                    <button type="button" onClick={() => void deleteTask(task)} aria-label="删除待办" className="rounded-lg p-2 text-[#9aa5b5] hover:bg-[#fff0ec] hover:text-[#a8493d]"><Trash2 size={16} /></button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
