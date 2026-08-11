"use client";

import { ChevronLeft, Download, FileImage, ShieldCheck, Upload } from "lucide-react";
import { type ComponentPropsWithoutRef, type FormEvent, useState } from "react";
import { customerRequestHeaders } from "@/app/customers/request";

function Link({ children, ...props }: ComponentPropsWithoutRef<"a">) {
  return <a {...props}>{children}</a>;
}

const EXPORT_CONTENTS = [
  "客户姓名、手机号、店铺名字和客户分类",
  "机器类型、购买/赠送模式和费率",
  "机器押金、地址和客户标签",
  "完整银行卡号",
  "身份证正面与反面原始图片",
  "营业执照或名片图片",
  "下次跟进时间和操作记录",
];

export function DataSettingsClient() {
  const [file, setFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function exportPlainBackup() {
    if (exporting) return;
    const accepted = window.confirm(
      "导出文件不加密，将包含完整手机号、银行卡号及证件/营业执照图片数据。请只保存到你本人控制的设备，确定继续吗？",
    );
    if (!accepted) return;
    setExporting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/backup", {
        headers: customerRequestHeaders(),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("export failed");
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const matched = /filename="([^"]+)"/.exec(disposition);
      const filename = matched?.[1] ?? `sales-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
      setMessage("未加密资料库已导出，请妥善保管下载的 JSON 文件。");
    } catch {
      setMessage("导出失败，请检查网络后重试。");
    } finally {
      setExporting(false);
    }
  }

  async function restore(event: FormEvent) {
    event.preventDefault();
    if (!file || restoring) return;
    setRestoring(true);
    setMessage(null);
    const form = new FormData();
    form.append("backup", file);
    try {
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: customerRequestHeaders(),
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as {
        imported?: number;
        skipped?: number;
      } | null;
      if (!response.ok) throw new Error();
      setMessage(
        `恢复完成：新增 ${payload?.imported ?? 0} 位客户，跳过 ${payload?.skipped ?? 0} 位重复或无效客户。`,
      );
      setFile(null);
    } catch {
      setMessage("恢复失败，请确认文件由本工作台导出且未损坏。 ");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f3f6fb] text-[#172033]">
      <header className="border-b border-[#e7ecf5] bg-white">
        <div className="mx-auto flex h-14 max-w-4xl items-center px-4 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#526071]">
            <ChevronLeft size={18} />返回工作台
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-7 sm:px-6 sm:py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2f6bff]">Data safety</p>
        <h1 className="mt-2 text-2xl font-semibold">导出、备份与恢复</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667085]">
          一次导出当前账号的全部客户资料。按你的个人使用要求，下载文件为普通 JSON，不再加密。
        </p>

        <section className="mt-6 overflow-hidden rounded-2xl border border-[#cbd9fb] bg-white shadow-sm">
          <div className="grid gap-6 bg-gradient-to-br from-[#edf3ff] to-white p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
            <div>
              <span className="grid size-11 place-items-center rounded-xl bg-[#2f6bff] text-white"><FileImage size={22} /></span>
              <h2 className="mt-4 text-xl font-semibold">导出全部客户资料</h2>
              <p className="mt-2 text-sm leading-6 text-[#667085]">
                导出为普通 .json 文件，可直接保存，也可在本页恢复到手机或电脑网页。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void exportPlainBackup()}
              disabled={exporting}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#2f6bff] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#245ae8]"
            >
              <Download size={18} />{exporting ? "正在整理资料…" : "导出未加密资料"}
            </button>
          </div>
          <div className="border-t border-[#e7ecf5] p-5 sm:p-6">
            <p className="text-sm font-semibold text-[#344054]">导出内容包括</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {EXPORT_CONTENTS.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-6 text-[#526071]">
                  <span className="mt-1 text-[#2f6bff]">✓</span><span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 rounded-xl bg-[#fff7e8] px-4 py-3 text-xs leading-5 text-[#8a5a18]">
              注意：JSON 文件未加密，包含完整敏感资料与图片 Base64 数据。不要发送给他人，也不要上传到公共网盘。
            </p>
          </div>
        </section>

        <form onSubmit={restore} className="mt-5 rounded-2xl border border-[#e7ecf5] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#e9f8f1] text-[#27805f]"><Upload size={21} /></span>
            <div><h2 className="text-lg font-semibold">恢复资料库</h2><p className="mt-1 text-sm leading-6 text-[#667085]">支持普通 JSON 和旧版 .xkbak，并自动跳过手机号相同的客户。</p></div>
          </div>
          <input
            type="file"
            accept=".json,.xkbak,application/json,application/octet-stream"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-5 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#eef4ff] file:px-3 file:py-2 file:font-semibold file:text-[#2859d9]"
          />
          <button type="submit" disabled={!file || restoring} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#27805f] text-sm font-semibold text-white disabled:opacity-50 sm:w-auto sm:px-6">
            <ShieldCheck size={17} />{restoring ? "正在恢复…" : "开始恢复"}
          </button>
        </form>

        {message && <p role="status" className="mt-5 rounded-xl border border-[#d9e4fb] bg-white px-4 py-3 text-sm text-[#526071]">{message}</p>}
      </main>
    </div>
  );
}
