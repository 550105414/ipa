"use client";

import {
  type ComponentPropsWithoutRef,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clearLocalVault,
  LOCAL_CUSTOMER_CATEGORIES,
  searchLocalCustomersPage,
  type LocalCustomerCategory,
  type LocalCustomerSearchPage,
  type LocalCustomerSummary,
} from "@/lib/local-vault";
import type {
  CustomerSearchItem,
  CustomerSearchResponse,
  ProfileStatus,
} from "./types";
import { apiErrorMessage, customerRequestHeaders } from "./request";
import {
  clearRememberedLocalVaultSession,
  getLocalVaultScope,
  unlockLocalVaultSession,
} from "./local-vault-session";

type StatusFilter = "all" | ProfileStatus;
type PeriodFilter = "all" | "this_month" | "last_month";
type CategoryFilter = "all" | LocalCustomerCategory;
type CustomerViewMode = "cards" | "list";

const PAGE_SIZE = 20;

function Link({ children, ...props }: ComponentPropsWithoutRef<"a">) {
  return <a {...props}>{children}</a>;
}

function formatDate(value: string | null): string {
  if (!value) return "时间未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function statusLabel(status: ProfileStatus): string {
  return status === "completed" ? "资料完整" : "资料待补";
}

function localSummaryToSearchItem(
  customer: LocalCustomerSummary,
): CustomerSearchItem {
  return {
    kind: "customer",
    id: customer.id,
    name: customer.name,
    shopName: customer.shopName ?? null,
    maskedPhone: customer.maskedPhone,
    profileStatus: customer.profileStatus,
    category: customer.category,
    createdAt: customer.createdAt,
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as T | null;

  if (!response.ok) {
    throw new Error(apiErrorMessage(payload, "请求失败，请稍后重试"));
  }

  if (!payload) throw new Error("服务返回了无效数据");
  return payload;
}

export function CustomersClient({
  initialStatus = "all",
}: {
  initialStatus?: StatusFilter;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [viewMode, setViewMode] = useState<CustomerViewMode>("list");
  const [remoteCustomers, setRemoteCustomers] = useState<CustomerSearchItem[]>(
    [],
  );
  const [localCustomers, setLocalCustomers] = useState<CustomerSearchItem[]>(
    [],
  );
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [localNextCursor, setLocalNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | undefined>();
  const [localTotal, setLocalTotal] = useState(0);
  const [isLocalVaultAvailable, setIsLocalVaultAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const [localVaultError, setLocalVaultError] = useState<string | null>(null);
  const [showClearData, setShowClearData] = useState(false);
  const [clearPassword, setClearPassword] = useState("");
  const [isClearingData, setIsClearingData] = useState(false);
  const [clearDataMessage, setClearDataMessage] = useState<string | null>(null);
  const [deletingCustomerId, setDeletingCustomerId] = useState<string | null>(
    null,
  );
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const mergedCustomers = useMemo(() => {
    const byId = new Map<string, CustomerSearchItem>();
    for (const customer of remoteCustomers) byId.set(customer.id, customer);
    for (const customer of localCustomers) {
      if (!byId.has(customer.id)) byId.set(customer.id, customer);
    }
    return [...byId.values()].sort((left, right) =>
      (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
    );
  }, [localCustomers, remoteCustomers]);
  const customers = mergedCustomers.slice(0, visibleCount);

  useEffect(() => {
    if (isComposing) return;

    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, 300);

    return () => window.clearTimeout(timer);
  }, [isComposing, searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;

    async function searchCustomers() {
      setIsLoading(true);
      setIsLoadingMore(false);
      setError(null);
      setVisibleCount(PAGE_SIZE);

      const remoteRequest = fetch("/api/search", {
        method: "POST",
        headers: customerRequestHeaders(true),
        body: JSON.stringify({
          q: debouncedQuery,
          scope: "customers",
          status,
          period,
          category,
          limit: PAGE_SIZE,
        }),
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => readJson<CustomerSearchResponse>(response));
      const localRequest = getLocalVaultScope(controller.signal).then(
        async (scope) => ({
          enabled: Boolean(scope),
          page: scope
            ? await searchLocalCustomersPage(
                debouncedQuery,
                { status, period, category, limit: PAGE_SIZE },
                scope,
              )
            : ({
                items: [] as LocalCustomerSummary[],
                nextCursor: null,
                total: 0,
              } satisfies LocalCustomerSearchPage),
        }),
      );

      const [remoteResult, localResult] = await Promise.allSettled([
        remoteRequest,
        localRequest,
      ]);
      if (controller.signal.aborted || version !== requestVersion.current) {
        return;
      }

      if (remoteResult.status === "fulfilled") {
        setRemoteCustomers(
          remoteResult.value.items.filter((item) => item.kind === "customer"),
        );
        setNextCursor(remoteResult.value.nextCursor ?? null);
        setTotal(remoteResult.value.total);
      } else {
        setRemoteCustomers([]);
        setNextCursor(null);
        setTotal(undefined);
      }

      if (localResult.status === "fulfilled") {
        setIsLocalVaultAvailable(localResult.value.enabled);
        setLocalCustomers(
          localResult.value.page.items.map(localSummaryToSearchItem),
        );
        setLocalNextCursor(localResult.value.page.nextCursor);
        setLocalTotal(localResult.value.page.total);
        setLocalVaultError(null);
      } else {
        setIsLocalVaultAvailable(false);
        setLocalCustomers([]);
        setLocalNextCursor(null);
        setLocalTotal(0);
        setLocalVaultError("本机加密资料暂时无法读取。 ");
      }

      if (remoteResult.status === "rejected") {
        const localSearchAvailable =
          localResult.status === "fulfilled" && localResult.value.enabled;
        if (!localSearchAvailable) {
          setError("客户搜索暂时不可用，请稍后重试。 ");
        }
      }
      setIsLoading(false);
    }

    void searchCustomers();
    return () => controller.abort();
  }, [category, debouncedQuery, period, reloadToken, status]);

  async function loadMore() {
    if (isLoadingMore) return;
    if (visibleCount < mergedCustomers.length) {
      setVisibleCount((current) => current + PAGE_SIZE);
      return;
    }
    if (!nextCursor && !localNextCursor) return;

    const remoteCursor = nextCursor;
    const localCursor = localNextCursor;
    const version = requestVersion.current;
    setIsLoadingMore(true);
    setError(null);

    try {
      const remoteRequest: Promise<CustomerSearchResponse | null> =
        remoteCursor
          ? fetch("/api/search", {
              method: "POST",
              headers: customerRequestHeaders(true),
              body: JSON.stringify({
                q: debouncedQuery,
                scope: "customers",
                status,
                period,
                category,
                cursor: remoteCursor,
                limit: PAGE_SIZE,
              }),
              cache: "no-store",
            }).then((response) =>
              readJson<CustomerSearchResponse>(response),
            )
          : Promise.resolve(null);
      const localRequest: Promise<LocalCustomerSearchPage | null> = localCursor
        ? getLocalVaultScope().then((scope) =>
            scope
              ? searchLocalCustomersPage(
                  debouncedQuery,
                  { status, period, category, limit: PAGE_SIZE },
                  { ...scope, cursor: localCursor },
                )
              : null,
          )
        : Promise.resolve(null);
      const [remoteResult, localResult] = await Promise.allSettled([
        remoteRequest,
        localRequest,
      ]);
      if (version !== requestVersion.current) return;

      let loadedSource = false;
      if (
        remoteResult.status === "fulfilled" &&
        remoteResult.value !== null
      ) {
        loadedSource = true;
        const page = remoteResult.value;
        setRemoteCustomers((current) => {
          const knownIds = new Set(current.map((customer) => customer.id));
          const additions = page.items.filter(
            (item) => item.kind === "customer" && !knownIds.has(item.id),
          );
          return [...current, ...additions];
        });
        setNextCursor(page.nextCursor ?? null);
        setTotal(page.total);
      }

      if (
        localResult.status === "fulfilled" &&
        localResult.value !== null
      ) {
        loadedSource = true;
        const page = localResult.value;
        setLocalCustomers((current) => {
          const knownIds = new Set(current.map((customer) => customer.id));
          const additions = page.items
            .map(localSummaryToSearchItem)
            .filter((customer) => !knownIds.has(customer.id));
          return [...current, ...additions];
        });
        setLocalNextCursor(page.nextCursor);
        setLocalTotal(page.total);
        setLocalVaultError(null);
      } else if (localCursor) {
        if (localResult.status === "fulfilled") setLocalNextCursor(null);
        setLocalVaultError("本机客户的下一页暂时无法读取。 ");
      }

      if (loadedSource) {
        setVisibleCount((current) => current + PAGE_SIZE);
      } else {
        setError("加载更多失败，请稍后重试。 ");
      }
    } finally {
      if (version === requestVersion.current) setIsLoadingMore(false);
    }
  }

  function clearFilters() {
    setSearchInput("");
    setDebouncedQuery("");
    setStatus("all");
    setPeriod("all");
    setCategory("all");
  }

  async function clearAllLocalData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clearPassword || isClearingData) return;
    setIsClearingData(true);
    setClearDataMessage(null);
    try {
      const unlocked = await unlockLocalVaultSession(clearPassword);
      await clearLocalVault(unlocked.session);
      clearRememberedLocalVaultSession();
      setLocalCustomers([]);
      setLocalNextCursor(null);
      setLocalTotal(0);
      setClearPassword("");
      setShowClearData(false);
      try {
        for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
          const key = window.localStorage.key(index);
          if (key?.startsWith("sales-workbench-recent-searches-v1:")) {
            window.localStorage.removeItem(key);
          }
        }
      } catch {
        // Search history is optional and may be unavailable in private mode.
      }
      setClearDataMessage("本机客户资料和搜索记录已全部清空。");
      setReloadToken((value) => value + 1);
    } catch {
      setClearDataMessage("清空失败，请检查验证密码后重试。");
    } finally {
      setIsClearingData(false);
      setClearPassword("");
    }
  }

  async function deleteCustomer(customer: CustomerSearchItem) {
    if (customer.id.startsWith("local_")) {
      setDeleteMessage("本机旧资料请使用上方“清空本机资料”处理。 ");
      return;
    }
    if (
      !window.confirm(
        `确定将客户“${customer.name}”移入回收站吗？资料会保留 30 天，可随时恢复。`,
      )
    ) {
      return;
    }

    setDeletingCustomerId(customer.id);
    setDeleteMessage(null);
    try {
      const response = await fetch(
        `/api/customers/${encodeURIComponent(customer.id)}`,
        {
          method: "DELETE",
          headers: customerRequestHeaders(),
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as unknown;
        throw new Error(apiErrorMessage(payload, "删除客户失败，请稍后重试"));
      }
      setRemoteCustomers((current) =>
        current.filter((item) => item.id !== customer.id),
      );
      setTotal((current) =>
        typeof current === "number" ? Math.max(0, current - 1) : current,
      );
      setDeleteMessage(`已将客户“${customer.name}”移入回收站。`);
    } catch (caught) {
      setDeleteMessage(
        caught instanceof Error ? caught.message : "删除客户失败，请稍后重试。",
      );
    } finally {
      setDeletingCustomerId(null);
    }
  }

  const isDebouncing = isComposing || searchInput.trim() !== debouncedQuery;
  const hasFilters =
    searchInput.length > 0 ||
    status !== "all" ||
    period !== "all" ||
    category !== "all";
  const knownLocalOverlap = localCustomers.filter(
    (localCustomer) =>
      remoteCustomers.some(
        (remoteCustomer) => remoteCustomer.id === localCustomer.id,
      ),
  ).length;
  const combinedTotal =
    (typeof total === "number" ? total : remoteCustomers.length) +
    localTotal -
    knownLocalOverlap;
  const hasMore =
    visibleCount < mergedCustomers.length ||
    Boolean(nextCursor) ||
    Boolean(localNextCursor);

  return (
    <div className="min-h-screen bg-[#f3f6fb] text-[#172033]">
      <header className="sticky top-0 z-30 border-b border-[#e7ecf5] bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="group flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f6bff] focus-visible:ring-offset-2"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-[#2f6bff] text-sm font-bold text-white shadow-sm">
              销
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight">
                销售工作台
              </span>
              <span className="hidden text-[11px] text-[#7a8699] sm:block">
                Sales Workspace
              </span>
            </span>
          </Link>

          <nav aria-label="主导航" className="flex items-center gap-1 text-sm">
            <Link
              href="/"
              className="rounded-lg px-3 py-2 text-[#667085] transition-colors hover:bg-white hover:text-[#172033]"
            >
              首页
            </Link>
            <span className="rounded-lg bg-[#eef4ff] px-3 py-2 font-semibold text-[#2f6bff]">
              客户
            </span>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <section className="mb-5 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#2f6bff]">
              Customer records
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">
              客户档案
            </h1>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-[#667085]">
              输入姓名或手机号即可查找，并可与资料状态、录入时间组合筛选。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <span className="hidden rounded-full border border-[#e7ecf5] bg-white px-4 py-2 text-xs font-medium text-[#5f6b7a] shadow-sm lg:inline-flex">
              每页最多 {PAGE_SIZE} 条
            </span>
            <Link href="/customers/trash" className="rounded-xl border border-[#d9e2f0] bg-white px-3 py-2.5 text-xs font-semibold text-[#526071] shadow-sm">回收站</Link>
            <Link href="/activity" className="rounded-xl border border-[#d9e2f0] bg-white px-3 py-2.5 text-xs font-semibold text-[#526071] shadow-sm">操作记录</Link>
            <a
              href="/api/backup"
              className="rounded-xl border border-[#bdd0ff] bg-[#eef4ff] px-3 py-2.5 text-xs font-semibold text-[#2859d9] shadow-sm"
            >
              ↓ 导出全部资料
            </a>
            <Link href="/settings/data" className="rounded-xl border border-[#d9e2f0] bg-white px-3 py-2.5 text-xs font-semibold text-[#526071] shadow-sm">备份与恢复</Link>
            <Link
              href="/customers/new"
              className="rounded-xl bg-[#2f6bff] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#245ae8]"
            >
              ＋ 新增客户
            </Link>
          </div>
        </section>

        <section
          aria-label="客户搜索与筛选"
          className="relative overflow-hidden rounded-xl border border-[#e7ecf5] bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.04)] sm:p-5"
        >
          <div className="pointer-events-none absolute -right-16 -top-20 size-52 rounded-full bg-[#eaf1ff]/60 blur-2xl" />
          <div className="relative">
            <label
              htmlFor="customer-search"
              className="mb-2 block text-xs font-semibold tracking-wide text-[#5f6b7a]"
            >
              搜索客户
            </label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-[#2f6bff]"
              >
                ⌕
              </span>
              <input
                id="customer-search"
                type="search"
                inputMode="search"
                autoComplete="off"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={(event) => {
                  setIsComposing(false);
                  setSearchInput(event.currentTarget.value);
                }}
                placeholder="姓名 / 手机号 / 店铺名字"
                className="h-12 w-full rounded-lg border border-[#d9e2f0] bg-[#f8faff] pl-12 pr-12 text-sm outline-none transition focus:border-[#2f6bff] focus:bg-white focus:ring-4 focus:ring-[#2f6bff]/10"
              />
              {(isDebouncing || isLoading) && (
                <span
                  className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-[#a8b4c6] border-t-[#2f6bff]"
                  aria-label={isDebouncing ? "等待输入完成" : "正在搜索"}
                />
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
              <label className="block">
                <span className="sr-only">资料状态</span>
                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as StatusFilter)
                  }
                  className="h-11 w-full rounded-xl border border-[#d9e2f0] bg-white px-3 text-sm font-medium text-[#344054] outline-none transition focus:border-[#2f6bff] focus:ring-4 focus:ring-[#2f6bff]/10"
                >
                  <option value="all">全部资料状态</option>
                  <option value="completed">资料完整</option>
                  <option value="draft">资料待补</option>
                </select>
              </label>

              <label className="block">
                <span className="sr-only">客户分类</span>
                <select
                  aria-label="客户分类"
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as CategoryFilter)
                  }
                  className="h-11 w-full rounded-xl border border-[#d9e2f0] bg-white px-3 text-sm font-medium text-[#344054] outline-none transition focus:border-[#2f6bff] focus:ring-4 focus:ring-[#2f6bff]/10"
                >
                  <option value="all">全部客户分类</option>
                  {LOCAL_CUSTOMER_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="sr-only">录入时间</span>
                <select
                  value={period}
                  onChange={(event) =>
                    setPeriod(event.target.value as PeriodFilter)
                  }
                  className="h-11 w-full rounded-xl border border-[#d9e2f0] bg-white px-3 text-sm font-medium text-[#344054] outline-none transition focus:border-[#2f6bff] focus:ring-4 focus:ring-[#2f6bff]/10"
                >
                  <option value="all">全部录入时间</option>
                  <option value="this_month">本月录入</option>
                  <option value="last_month">上月录入</option>
                </select>
              </label>

              <button
                type="button"
                onClick={clearFilters}
                disabled={!hasFilters}
                className="h-11 rounded-xl border border-[#d9e2f0] px-4 text-sm font-medium text-[#5f6b7a] transition hover:border-[#b9c8df] hover:bg-[#f7f9fc] disabled:cursor-not-allowed disabled:opacity-40"
              >
                重置筛选
              </button>
            </div>
          </div>
        </section>

        {(isLocalVaultAvailable || localVaultError) && (
          <section
            aria-label="本机加密资料库"
            className="mt-3 rounded-xl border border-[#d9e4fb] bg-[#f8faff] p-4"
          >
            {isLocalVaultAvailable && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#2859d9]">
                    已合并此浏览器中的客户
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#667085]">
                    姓名、脱敏手机号与资料状态无需密码即可搜索；完整手机号、证件图片和银行卡仍需验证。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[#eaf1ff] px-3 py-1.5 text-xs font-semibold text-[#2859d9]">
                    本机加密
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowClearData((value) => !value);
                      setClearDataMessage(null);
                    }}
                    className="rounded-lg border border-[#e3c5bf] bg-white px-3 py-1.5 text-xs font-semibold text-[#9b3f32]"
                  >
                    清空本机资料
                  </button>
                </div>
              </div>
            )}
            {showClearData && (
              <form
                onSubmit={clearAllLocalData}
                className="mt-4 rounded-xl border border-[#ecd2cc] bg-white p-4"
              >
                <p className="text-sm font-semibold text-[#8f3328]">
                  清空后无法恢复
                </p>
                <p className="mt-1 text-xs leading-5 text-[#667085]">
                  仅删除当前账号在此浏览器保存的客户、身份证图片、银行卡号和搜索记录。
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="password"
                    aria-label="清空资料验证密码"
                    autoComplete="current-password"
                    value={clearPassword}
                    onChange={(event) => setClearPassword(event.target.value)}
                    placeholder="输入验证密码"
                    className="h-10 flex-1 rounded-lg border border-[#d9e2f0] px-3 text-sm outline-none focus:border-[#2f6bff]"
                  />
                  <button
                    type="submit"
                    disabled={!clearPassword || isClearingData}
                    className="h-10 rounded-lg bg-[#a63d32] px-4 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {isClearingData ? "正在清空…" : "确认清空"}
                  </button>
                </div>
              </form>
            )}
            {clearDataMessage && (
              <p role="status" className="mt-2 text-xs text-[#5f6b7a]">
                {clearDataMessage}
              </p>
            )}
            {localVaultError && (
              <p role="status" className="mt-2 text-xs text-[#99502f]">
                {localVaultError}
              </p>
            )}
          </section>
        )}

        <section aria-labelledby="customer-results" className="mt-6">
          <div className="mb-4 flex min-h-7 flex-wrap items-center justify-between gap-3">
            <div>
              <h2
                id="customer-results"
                className="text-lg font-semibold tracking-tight"
              >
                客户列表
              </h2>
              {!isLoading && !error && (
                <p className="mt-0.5 text-xs text-[#7a8699]" aria-live="polite">
                  {`共 ${combinedTotal} 位客户，当前显示 ${customers.length} 位`}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {debouncedQuery && !isLoading && (
                <p className="hidden max-w-52 truncate rounded-full bg-[#eaf1ff] px-3 py-1.5 text-xs font-medium text-[#2859d9] sm:block">
                  “{debouncedQuery}”
                </p>
              )}
              <div
                className="flex rounded-lg border border-[#d9e2f0] bg-white p-1"
                aria-label="客户显示方式"
              >
                <button
                  type="button"
                  aria-pressed={viewMode === "list"}
                  onClick={() => setViewMode("list")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    viewMode === "list"
                      ? "bg-[#2f6bff] text-white"
                      : "text-[#667085] hover:bg-[#f3f6fb]"
                  }`}
                >
                  列表
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "cards"}
                  onClick={() => setViewMode("cards")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    viewMode === "cards"
                      ? "bg-[#2f6bff] text-white"
                      : "text-[#667085] hover:bg-[#f3f6fb]"
                  }`}
                >
                  卡片
                </button>
              </div>
            </div>
          </div>

          {deleteMessage && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-[#d9e4fb] bg-[#f8faff] px-4 py-2.5 text-sm text-[#526071]"
            >
              {deleteMessage}
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-[#ead3c6] bg-[#fff8f3] px-5 py-6 text-center"
            >
              <p className="font-semibold text-[#7b3e27]">暂时无法显示客户</p>
              <p className="mt-1 text-sm text-[#8b5c49]">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setReloadToken((value) => value + 1);
                }}
                className="mt-4 rounded-xl bg-[#7b3e27] px-4 py-2 text-sm font-semibold text-white"
              >
                重新加载
              </button>
            </div>
          )}

          {(isLoading || isDebouncing) && customers.length === 0 && (
            <div className="grid gap-4 lg:grid-cols-2" aria-label="正在加载客户">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  className="h-56 animate-pulse rounded-xl border border-[#e7ecf5] bg-white"
                />
              ))}
            </div>
          )}

          {!isLoading && !isDebouncing && !error && customers.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#d9e2f0] bg-white/60 px-5 py-14 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-xl bg-[#eaf1ff] text-2xl text-[#2859d9]">
                ⌕
              </div>
              <h3 className="mt-4 text-base font-semibold">没有找到匹配客户</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-[#667085]">
                请尝试姓名的部分文字、手机号的连续数字，或调整资料状态与录入时间。
              </p>
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-5 rounded-xl border border-[#d9e2f0] bg-white px-4 py-2 text-sm font-semibold text-[#2859d9] shadow-sm"
                >
                  清除全部条件
                </button>
              )}
            </div>
          )}

          {customers.length > 0 && viewMode === "cards" && (
            <div
              className={`grid gap-3 lg:grid-cols-2 ${isLoading ? "opacity-60" : "opacity-100"} transition-opacity`}
              aria-busy={isLoading}
            >
              {customers.map((customer) => {
                const complete = customer.profileStatus === "completed";
                const sensitiveHref = `/customers/${encodeURIComponent(customer.id)}#sensitive-information`;

                return (
                  <article
                    key={customer.id}
                    className="group overflow-hidden rounded-xl border border-[#e7ecf5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-[#cbd6e8] hover:shadow-[0_4px_12px_rgba(47,107,255,0.08)]"
                  >
                    <Link
                      href={`/customers/${encodeURIComponent(customer.id)}`}
                      className="block p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f6bff] sm:p-5"
                      aria-label={`查看客户 ${customer.name}`}
                    >
                      <div className="flex items-start gap-4">
                        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#eaf1ff] text-base font-semibold text-[#2859d9]">
                          {customer.name.trim().charAt(0) || "客"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="truncate text-base font-semibold tracking-tight text-[#172033]">
                                  {customer.name}
                                </h3>
                                {customer.id.startsWith("local_") && (
                                  <span className="shrink-0 rounded bg-[#eef4ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#2f6bff]">
                                    本机
                                  </span>
                                )}
                                {customer.category && (
                                  <span className="shrink-0 rounded-full bg-[#f1ecff] px-2 py-0.5 text-[10px] font-semibold text-[#6d4bc3]">
                                    {customer.category}
                                  </span>
                                )}
                              </div>
                              {customer.shopName && (
                                <p className="mt-1 truncate text-sm font-medium text-[#526071]">
                                  店铺：{customer.shopName}
                                </p>
                              )}
                              <p className="mt-1 font-mono text-sm tracking-wide text-[#5f6b7a]">
                                {customer.maskedPhone || "手机号未填写"}
                              </p>
                            </div>
                            <span
                              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                complete
                                  ? "bg-[#eaf1ff] text-[#2859d9]"
                                  : "bg-[#fff1df] text-[#94591f]"
                              }`}
                            >
                              <span aria-hidden="true">
                                {complete ? "✓" : "!"}
                              </span>
                              {statusLabel(customer.profileStatus)}
                            </span>
                          </div>

                          <div className="mt-4 flex items-end justify-between gap-3 border-t border-[#edf1f7] pt-3">
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8a95a6]">
                                录入时间
                              </p>
                              <p className="mt-1 text-sm font-medium text-[#526071]">
                                {formatDate(customer.createdAt)}
                              </p>
                            </div>
                            <span
                              aria-hidden="true"
                              className="grid size-8 place-items-center rounded-full bg-[#f3f6fb] text-lg text-[#2f6bff] transition group-hover:translate-x-0.5 group-hover:bg-[#eaf1ff]"
                            >
                              ›
                            </span>
                          </div>
                        </div>
                      </div>
                    </Link>

                    <div className="grid grid-cols-4 border-t border-[#edf1f7] bg-[#f8faff] text-sm">
                      <Link
                        href={`/customers/${encodeURIComponent(customer.id)}`}
                        className="px-2 py-3 text-center font-semibold text-[#2859d9] outline-none transition hover:bg-[#eef4ff] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f6bff]"
                      >
                        查看客户
                      </Link>
                      <Link
                        href={sensitiveHref}
                        aria-label={`在详情中拨打 ${customer.name} 的电话`}
                        className="border-x border-[#edf1f7] px-2 py-3 text-center font-medium text-[#526071] transition hover:bg-[#eef4ff]"
                      >
                        详情中拨号
                      </Link>
                      <Link
                        href={sensitiveHref}
                        aria-label={`在详情中复制 ${customer.name} 的手机号`}
                        className="px-2 py-3 text-center font-medium text-[#526071] transition hover:bg-[#eef4ff]"
                      >
                        详情中复制
                      </Link>
                      <button
                        type="button"
                        onClick={() => void deleteCustomer(customer)}
                        disabled={deletingCustomerId === customer.id}
                        className="border-l border-[#edf1f7] px-2 py-3 text-center font-medium text-[#a23d32] transition hover:bg-[#fff1ef] disabled:cursor-wait disabled:opacity-50"
                      >
                        {deletingCustomerId === customer.id ? "处理中" : "回收站"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {customers.length > 0 && viewMode === "list" && (
            <div
              className={`overflow-hidden rounded-xl border border-[#e7ecf5] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] ${isLoading ? "opacity-60" : "opacity-100"} transition-opacity`}
              aria-busy={isLoading}
            >
              <div className="hidden grid-cols-[minmax(180px,1.5fr)_110px_145px_110px_160px_70px] gap-4 border-b border-[#e7ecf5] bg-[#f8faff] px-5 py-3 text-xs font-semibold text-[#7a8699] md:grid">
                <span>客户</span>
                <span>分类</span>
                <span>手机号</span>
                <span>资料状态</span>
                <span>录入时间</span>
                <span className="text-right">操作</span>
              </div>
              <div className="divide-y divide-[#edf1f7]">
                {customers.map((customer) => {
                  const complete = customer.profileStatus === "completed";
                  return (
                    <article
                      key={customer.id}
                      className="group px-4 py-4 transition hover:bg-[#f8faff] sm:px-5"
                    >
                      <div className="grid gap-3 md:grid-cols-[minmax(180px,1.5fr)_110px_145px_110px_160px_70px] md:items-center md:gap-4">
                        <Link
                          href={`/customers/${encodeURIComponent(customer.id)}`}
                          className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#2f6bff]"
                          aria-label={`查看客户 ${customer.name}`}
                        >
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#eaf1ff] font-semibold text-[#2859d9]">
                            {customer.name.trim().charAt(0) || "客"}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-[#172033]">
                              {customer.name}
                            </span>
                            {customer.shopName && (
                              <span className="mt-0.5 block truncate text-xs font-medium text-[#526071]">
                                店铺：{customer.shopName}
                              </span>
                            )}
                            <span className="mt-0.5 block text-xs text-[#7a8699] md:hidden">
                              {customer.maskedPhone || "手机号未填写"}
                            </span>
                          </span>
                        </Link>
                        <span className="w-fit rounded-full bg-[#f1ecff] px-2.5 py-1 text-xs font-semibold text-[#6d4bc3]">
                          {customer.category || "直营"}
                        </span>
                        <span className="hidden font-mono text-sm tracking-wide text-[#526071] md:block">
                          {customer.maskedPhone || "手机号未填写"}
                        </span>
                        <span
                          className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${
                            complete
                              ? "bg-[#eaf1ff] text-[#2859d9]"
                              : "bg-[#fff1df] text-[#94591f]"
                          }`}
                        >
                          {complete ? "✓ " : "! "}
                          {statusLabel(customer.profileStatus)}
                        </span>
                        <span className="text-xs text-[#667085] sm:text-sm">
                          {formatDate(customer.createdAt)}
                        </span>
                        <div className="flex items-center gap-3 md:justify-end">
                          <Link
                            href={`/customers/${encodeURIComponent(customer.id)}`}
                            className="text-sm font-semibold text-[#2859d9]"
                          >
                            查看
                          </Link>
                          <button
                            type="button"
                            onClick={() => void deleteCustomer(customer)}
                            disabled={deletingCustomerId === customer.id}
                            className="text-sm font-semibold text-[#a23d32] disabled:cursor-wait disabled:opacity-50 md:hidden"
                          >
                            {deletingCustomerId === customer.id ? "处理中" : "回收站"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteCustomer(customer)}
                            disabled={deletingCustomerId === customer.id}
                            aria-label={`将客户 ${customer.name} 移入回收站`}
                            className="hidden text-sm font-semibold text-[#a23d32] disabled:cursor-wait disabled:opacity-50 md:inline"
                          >
                            回收站
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {hasMore && !error && (
            <div className="mt-7 text-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={isLoadingMore || isLoading}
                className="min-w-40 rounded-xl border border-[#cbd6e8] bg-white px-5 py-3 text-sm font-semibold text-[#2859d9] shadow-sm transition hover:-translate-y-0.5 hover:border-[#9db2d1] hover:shadow-md disabled:cursor-wait disabled:opacity-60"
              >
                {isLoadingMore ? "正在加载…" : "加载更多"}
              </button>
            </div>
          )}

          <Link
            href="/customers/new"
            className="fixed bottom-5 right-4 z-20 rounded-full bg-[#2f6bff] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(47,107,255,0.24)] sm:hidden"
          >
            ＋ 新增客户
          </Link>
        </section>
      </main>
    </div>
  );
}
