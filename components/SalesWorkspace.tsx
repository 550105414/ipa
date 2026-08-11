"use client";

import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Bell,
  CalendarCheck2,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Copy,
  House,
  History,
  LoaderCircle,
  LockKeyhole,
  Megaphone,
  Phone,
  Plus,
  Search,
  Sparkles,
  Store,
  DatabaseBackup,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import {
  type ComponentPropsWithoutRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getLocalPhone,
  searchLocalCustomersPage,
  type LocalCustomerSummary,
} from "@/lib/local-vault";
import {
  getLocalVaultScope,
  unlockLocalVaultSession,
} from "@/app/customers/local-vault-session";
import { syncOpenTasksToIOSWidget } from "@/lib/ios/todo-widget-bridge";

type ProfileStatus = "completed" | "draft";

type CustomerResult = {
  kind: "customer";
  id: string;
  name: string;
  shopName?: string | null;
  phone?: string;
  maskedPhone?: string;
  phoneMasked?: string;
  profileStatus?: ProfileStatus;
  status?: ProfileStatus;
  createdAt: string;
  source?: "local" | "remote";
  category?: LocalCustomerSummary["category"];
};

type MerchantResult = {
  kind: "merchant";
  id: string;
  merchantName?: string;
  name?: string;
  merchantNo?: string;
  terminalNo?: string;
  merchantStatus?: string;
  status?: string;
  createdAt?: string;
};

type SearchResult = CustomerResult | MerchantResult;

type SearchResponse = {
  items: SearchResult[];
  nextCursor: string | null;
  total?: number;
  demoMode?: boolean;
  error?: string | { code?: string; message?: string };
};

type PhoneAction = {
  customerId: string;
  customerName: string;
  kind: "call" | "copy";
  source: "local" | "remote";
};

const RECENT_SEARCH_KEY = "sales-workbench-recent-searches-v1";

function Link({ children, ...props }: ComponentPropsWithoutRef<"a">) {
  return <a {...props}>{children}</a>;
}

function getStoredAccessToken() {
  if (typeof window === "undefined") return null;

  const directToken = window.localStorage.getItem("sales-workbench-access-token");
  if (directToken) return directToken;

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !/^sb-.+-auth-token$/.test(key)) continue;

    try {
      const value = JSON.parse(window.localStorage.getItem(key) ?? "null");
      const token = value?.access_token ?? value?.currentSession?.access_token;
      if (typeof token === "string" && token.length > 0) return token;
    } catch {
      // Ignore malformed unrelated browser storage entries.
    }
  }

  return null;
}

function getRecentSearchKey(userScope?: string | null): string | null {
  const token = getStoredAccessToken();
  if (!token) {
    return userScope ? `${RECENT_SEARCH_KEY}:vault:${userScope}` : null;
  }

  try {
    const encodedPayload = token.split(".")[1];
    const normalizedPayload = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, "=");
    const payload = JSON.parse(window.atob(paddedPayload));
    if (typeof payload?.sub === "string" && payload.sub) return `${RECENT_SEARCH_KEY}:${payload.sub}`;
  } catch {
    // A malformed token is handled by the server; do not persist ambiguous history.
  }

  return null;
}

function requestHeaders() {
  const token = getStoredAccessToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

function isSensitiveSearchTerm(value: string) {
  const normalized = value.replace(/[\s-]+/g, "");
  return (
    /身份证|公民身份号码|银行卡|卡号|安全码|CVV|PIN|支付密码/i.test(value) ||
    /^\d{17}[\dXx]$/.test(normalized) ||
    /^\d{15}$/.test(normalized) ||
    /^\d{12,19}$/.test(normalized)
  );
}

function displayDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replaceAll("/", "-");
}

function maskPhone(phone?: string) {
  if (!phone) return "未填写手机号";
  if (/\*{4}/.test(phone)) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

function localCustomerResult(customer: LocalCustomerSummary): CustomerResult {
  return {
    kind: "customer",
    id: customer.id,
    name: customer.name,
    shopName: customer.shopName ?? null,
    maskedPhone: customer.maskedPhone,
    profileStatus: customer.profileStatus,
    createdAt: customer.createdAt,
    source: "local",
    category: customer.category,
  };
}

function mergeFirstPageResults(
  remoteItems: SearchResult[],
  localItems: LocalCustomerSummary[],
): SearchResult[] {
  const localResults = localItems.map(localCustomerResult);
  const seen = new Set(localResults.map((item) => `${item.kind}:${item.id}`));
  const combined: SearchResult[] = [...localResults];
  for (const item of remoteItems) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(
      item.kind === "customer" ? { ...item, source: "remote" } : item,
    );
  }

  const firstMerchantIndex = combined.findIndex((item) => item.kind === "merchant");
  if (
    firstMerchantIndex >= 20 &&
    combined.slice(0, 20).some((item) => item.kind === "customer")
  ) {
    const [firstMerchant] = combined.splice(firstMerchantIndex, 1);
    combined.splice(19, 0, firstMerchant);
  }
  return combined;
}

function SearchStatus({ status }: { status: ProfileStatus }) {
  if (status === "completed") {
    return (
      <span className="status-chip status-completed">
        <CheckCircle2 size={14} strokeWidth={2.4} />资料完整
      </span>
    );
  }

  return (
    <span className="status-chip status-draft">
      <AlertTriangle size={14} strokeWidth={2.3} />资料待补
    </span>
  );
}

function EmptySearch({ query }: { query: string }) {
  return (
    <div className="search-empty">
      <div className="empty-icon"><Search size={26} /></div>
      <h3>没有找到“{query}”</h3>
      <p>试试完整或部分姓名、手机号、店铺名字、商户编号、终端号。</p>
      <span>身份证号码和身份证图片内容不在搜索范围内</span>
    </div>
  );
}

export function SalesWorkspace() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [visibleSearchCount, setVisibleSearchCount] = useState(20);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [localNextCursor, setLocalNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [toast, setToast] = useState("");
  const [phoneAction, setPhoneAction] = useState<PhoneAction | null>(null);
  const [phonePassword, setPhonePassword] = useState("");
  const [phoneActionError, setPhoneActionError] = useState("");
  const [phoneActionLoading, setPhoneActionLoading] = useState(false);
  const [localVaultScope, setLocalVaultScope] = useState<string | null>(null);
  const [localRecentCustomers, setLocalRecentCustomers] = useState<CustomerResult[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState({
    total: 0,
    completed: 0,
    draft: 0,
  });
  const [openTaskCount, setOpenTaskCount] = useState(0);
  const [followUps, setFollowUps] = useState<{
    totalDue: number;
    overdue: number;
    items: Array<{
      id: string;
      name: string;
      maskedPhone: string;
      nextFollowUpAt: string;
      overdue: boolean;
    }>;
  }>({ totalDue: 0, overdue: 0, items: [] });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const phonePasswordInputRef = useRef<HTMLInputElement>(null);
  const searchControllerRef = useRef<AbortController | null>(null);
  const phoneActionControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getLocalVaultScope(controller.signal)
      .then((scope) => {
        if (!controller.signal.aborted) {
          setLocalVaultScope(scope?.userScope ?? null);
        }
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (!controller.signal.aborted) setLocalVaultScope(null);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/follow-ups", {
      headers: requestHeaders(),
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as typeof followUps)
          : { totalDue: 0, overdue: 0, items: [] },
      )
      .then((payload) => {
        if (!controller.signal.aborted) setFollowUps(payload);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!localVaultScope) {
      const controller = new AbortController();
      const fetchCustomers = (status: "all" | ProfileStatus, limit: number) =>
        fetch("/api/search", {
          method: "POST",
          headers: requestHeaders(),
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            q: "",
            scope: "customers",
            status,
            period: "all",
            category: "all",
            limit,
          }),
        }).then(async (response) => {
          if (!response.ok) throw new Error("dashboard unavailable");
          return (await response.json()) as SearchResponse;
        });
      void Promise.all([
        fetchCustomers("all", 3),
        fetchCustomers("completed", 1),
        fetchCustomers("draft", 1),
      ])
        .then(([all, completed, draft]) => {
          if (controller.signal.aborted) return;
          setLocalRecentCustomers(
            all.items
              .filter((item): item is CustomerResult => item.kind === "customer")
              .map((item) => ({ ...item, source: "remote" })),
          );
          setDashboardSummary({
            total: all.total ?? 0,
            completed: completed.total ?? 0,
            draft: draft.total ?? 0,
          });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setLocalRecentCustomers([]);
          setDashboardSummary({ total: 0, completed: 0, draft: 0 });
        });
      return () => controller.abort();
    }
    let active = true;
    void Promise.all([
      searchLocalCustomersPage(
        "",
        { status: "all", period: "all", category: "all", limit: 3 },
        { userScope: localVaultScope },
      ),
      searchLocalCustomersPage(
        "",
        { status: "completed", period: "all", category: "all", limit: 1 },
        { userScope: localVaultScope },
      ),
      searchLocalCustomersPage(
        "",
        { status: "draft", period: "all", category: "all", limit: 1 },
        { userScope: localVaultScope },
      ),
    ])
      .then(([all, completed, draft]) => {
        if (!active) return;
        setLocalRecentCustomers(all.items.map(localCustomerResult));
        setDashboardSummary({
          total: all.total,
          completed: completed.total,
          draft: draft.total,
        });
      })
      .catch(() => {
        if (!active) return;
        setLocalRecentCustomers([]);
        setDashboardSummary({ total: 0, completed: 0, draft: 0 });
      });
    return () => {
      active = false;
    };
  }, [localVaultScope]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/tasks", {
      headers: requestHeaders(),
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return { items: [] };
        return (await response.json()) as {
          items?: Array<{
            id: string;
            title: string;
            due_at: string | null;
            status: string;
          }>;
        };
      })
      .then((payload) => {
        if (!controller.signal.aborted) {
          syncOpenTasksToIOSWidget(payload.items ?? []);
          setOpenTaskCount(
            (payload.items ?? []).filter((item) => item.status === "open").length,
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setOpenTaskCount(0);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const storageKey = getRecentSearchKey(localVaultScope);
    if (!storageKey) return;
    let frame: number | null = null;
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(stored)) {
        const safeHistory = stored
          .filter(
            (item): item is string =>
              typeof item === "string" && !isSensitiveSearchTerm(item),
          )
          .slice(0, 6);
        frame = window.requestAnimationFrame(() => {
          setRecentSearches(safeHistory);
        });
      }
    } catch {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // History is optional and must not block search.
      }
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [localVaultScope]);

  useEffect(() => {
    if (isComposing) return;
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [isComposing, query]);

  const fetchResults = useCallback(async (
    searchTerm: string,
    remoteCursor?: string,
    localCursor?: string,
  ) => {
    if (!searchTerm) return;
    const isLoadMore = Boolean(remoteCursor || localCursor);
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    if (!isLoadMore) {
      setLoading(true);
      setLoadingMore(false);
      setVisibleSearchCount(20);
    } else {
      setLoadingMore(true);
    }
    setError("");

    try {
      const shouldFetchRemote = !isLoadMore || Boolean(remoteCursor);
      const shouldFetchLocal =
        Boolean(localVaultScope) && (!isLoadMore || Boolean(localCursor));
      const remoteRequest = shouldFetchRemote
        ? fetch("/api/search", {
            method: "POST",
            headers: requestHeaders(),
            credentials: "same-origin",
            cache: "no-store",
            body: JSON.stringify({
              q: searchTerm,
              scope: "all",
              limit: 20,
              cursor: remoteCursor,
            }),
            signal: controller.signal,
          }).then(async (response) => {
            const payload = (await response.json()) as SearchResponse;
            if (!response.ok) {
              const message =
                typeof payload.error === "string"
                  ? payload.error
                  : payload.error?.message || "搜索暂时不可用";
              throw new Error(message);
            }
            return payload;
          })
        : Promise.resolve<SearchResponse | null>(null);
      const localRequest = shouldFetchLocal
        ? searchLocalCustomersPage(
              searchTerm,
              { status: "all", period: "all", limit: 20 },
              {
                userScope: localVaultScope!,
                cursor: localCursor,
              },
            )
        : Promise.resolve(null);
      const [remoteResult, localResult] = await Promise.allSettled([
        remoteRequest,
        localRequest,
      ]);
      if (controller.signal.aborted) return;

      const remotePage =
        remoteResult.status === "fulfilled" ? remoteResult.value : null;
      const localPage =
        localResult.status === "fulfilled" ? localResult.value : null;
      const remoteFailed =
        shouldFetchRemote && remoteResult.status === "rejected";
      const localFailed =
        shouldFetchLocal && localResult.status === "rejected";
      if (
        (remoteFailed && (!shouldFetchLocal || localFailed)) ||
        (localFailed && !shouldFetchRemote)
      ) {
        throw remoteResult.status === "rejected"
          ? remoteResult.reason
          : localResult.status === "rejected"
            ? localResult.reason
            : new Error("搜索暂时不可用");
      }

      if (isLoadMore) {
        const additions: SearchResult[] = [
          ...(localPage?.items.map(localCustomerResult) ?? []),
          ...(remotePage?.items.map((item) =>
            item.kind === "customer"
              ? ({ ...item, source: "remote" as const } satisfies CustomerResult)
              : item,
          ) ?? []),
        ];
        setResults((current) => {
          const seen = new Set(current.map((item) => `${item.kind}:${item.id}`));
          const uniqueAdditions = additions.filter((item) => {
            const key = `${item.kind}:${item.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          return [...current, ...uniqueAdditions];
        });
        setVisibleSearchCount((current) => current + 20);
        if (remotePage) setNextCursor(remotePage.nextCursor ?? null);
        if (localPage) setLocalNextCursor(localPage.nextCursor ?? null);
        return;
      }

      const remoteItems = remotePage?.items ?? [];
      const localItems = localPage?.items ?? [];
      setResults(mergeFirstPageResults(remoteItems, localItems));
      setNextCursor(remotePage?.nextCursor ?? null);
      setLocalNextCursor(localPage?.nextCursor ?? null);
      const remoteTotal = remotePage?.total ?? remoteItems.length;
      setTotal(remoteTotal + (localPage?.total ?? localItems.length));
      setDemoMode(
        remotePage ? Boolean(remotePage.demoMode && remoteItems.length > 0) : false,
      );
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (!isLoadMore) setResults([]);
      setError(caught instanceof Error ? caught.message : "搜索暂时不可用");
    } finally {
      if (searchControllerRef.current === controller) {
        if (isLoadMore) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, [localVaultScope]);

  useEffect(() => {
    if (!debouncedQuery) {
      searchControllerRef.current?.abort();
      const frame = window.requestAnimationFrame(() => {
        setResults([]);
        setVisibleSearchCount(20);
        setNextCursor(null);
        setLocalNextCursor(null);
        setTotal(undefined);
        setError("");
        setLoading(false);
        setLoadingMore(false);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const frame = window.requestAnimationFrame(() => {
      void fetchResults(debouncedQuery);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [debouncedQuery, fetchResults]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!phoneAction) return;
    phonePasswordInputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      phoneActionControllerRef.current?.abort();
      phoneActionControllerRef.current = null;
      setPhoneAction(null);
      setPhonePassword("");
      setPhoneActionError("");
      setPhoneActionLoading(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phoneAction]);

  const visibleResults = useMemo(
    () => results.slice(0, visibleSearchCount),
    [results, visibleSearchCount],
  );
  const customerResults = useMemo(
    () => visibleResults.filter((result): result is CustomerResult => result.kind === "customer"),
    [visibleResults],
  );
  const merchantResults = useMemo(
    () => visibleResults.filter((result): result is MerchantResult => result.kind === "merchant"),
    [visibleResults],
  );

  const saveRecentSearch = useCallback((value: string) => {
    const cleaned = value.trim();
    if (!isMobile || !cleaned || isSensitiveSearchTerm(cleaned)) return;
    const storageKey = getRecentSearchKey(localVaultScope);
    if (!storageKey) return;
    setRecentSearches((current) => {
      const next = [cleaned, ...current.filter((item) => item !== cleaned)].slice(0, 6);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Searching must continue even when browser storage is unavailable.
      }
      return next;
    });
  }, [isMobile, localVaultScope]);

  const clearRecentSearches = () => {
    setRecentSearches([]);
    const storageKey = getRecentSearchKey(localVaultScope);
    try {
      if (storageKey) window.localStorage.removeItem(storageKey);
    } catch {
      // Storage may be disabled in private browsing.
    }
    setToast("搜索记录已清空");
  };

  const closePhoneAction = () => {
    phoneActionControllerRef.current?.abort();
    phoneActionControllerRef.current = null;
    setPhoneAction(null);
    setPhonePassword("");
    setPhoneActionError("");
    setPhoneActionLoading(false);
  };

  const performPhoneAction = async (
    requestedAction: PhoneAction | null = phoneAction,
  ) => {
    if (!requestedAction) return;
    if (requestedAction.source === "local" && !phonePassword) {
      setPhoneActionError("请输入验证密码");
      return;
    }

    setPhoneActionLoading(true);
    setPhoneActionError("");
    phoneActionControllerRef.current?.abort();
    const controller = new AbortController();
    phoneActionControllerRef.current = controller;
    try {
      let fullPhone: string;
      if (requestedAction.source === "local") {
        const unlocked = await unlockLocalVaultSession(
          phonePassword,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        fullPhone = await getLocalPhone(requestedAction.customerId, unlocked.session);
      } else {
        const response = await fetch(`/api/customers/${encodeURIComponent(requestedAction.customerId)}/phone`, {
          method: "POST",
          headers: requestHeaders(),
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({}),
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          phone?: string;
          error?: string | { message?: string };
        };
        if (controller.signal.aborted) return;
        if (!response.ok || !payload.phone) {
          const message =
            typeof payload.error === "string"
              ? payload.error
              : payload.error?.message || "手机号读取失败";
          throw new Error(message);
        }
        fullPhone = payload.phone;
      }

      if (requestedAction.kind === "copy") {
        await navigator.clipboard.writeText(fullPhone);
        setToast("手机号已复制");
        closePhoneAction();
      } else {
        const phone = fullPhone.replace(/[^+\d]/g, "");
        closePhoneAction();
        window.location.assign(`tel:${phone}`);
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      const message = caught instanceof Error ? caught.message : "操作失败，请重试";
      if (requestedAction.source === "remote") setToast(message);
      else setPhoneActionError(message);
    } finally {
      if (phoneActionControllerRef.current === controller) {
        phoneActionControllerRef.current = null;
        setPhoneActionLoading(false);
      }
    }
  };

  const beginPhoneAction = (
    customerId: string,
    customerName: string,
    kind: PhoneAction["kind"],
    source: PhoneAction["source"],
  ) => {
    const action = { customerId, customerName, kind, source } satisfies PhoneAction;
    setPhonePassword("");
    setPhoneActionError("");
    if (source === "remote") {
      setPhoneAction(null);
      void performPhoneAction(action);
      return;
    }
    setPhoneAction(action);
  };

  const clearSearch = () => {
    setQuery("");
    setDebouncedQuery("");
    if (isMobile) mobileSearchInputRef.current?.focus();
    else searchInputRef.current?.focus();
  };

  const focusMerchantSearch = () => {
    setQuery("");
    setDebouncedQuery("");
    setSearchFocused(true);
    setToast("请输入商户名称、商户编号或终端号");
    window.requestAnimationFrame(() => {
      if (isMobile) mobileSearchInputRef.current?.focus();
      else searchInputRef.current?.focus();
    });
  };

  const showSearchExperience = Boolean(query.trim() || (isMobile && searchFocused));
  const isDebouncing = isComposing || query.trim() !== debouncedQuery;
  const recentCustomerRows = localRecentCustomers.map((customer) => ({
        id: customer.id,
        name: customer.name,
        phone: customer.maskedPhone,
        status: customer.profileStatus,
        category: customer.category ?? "直营",
        time: displayDate(customer.createdAt),
        source: customer.source === "local" ? "本机加密录入" : "云端同步",
      }));
  const completionRate = dashboardSummary.total
    ? Math.round((dashboardSummary.completed / dashboardSummary.total) * 100)
    : 0;
  const statCards = [
    {
      label: "客户总数",
      value: String(dashboardSummary.total),
      note: "手机电脑云端同步",
      tone: "green",
    },
    {
      label: "资料待补",
      value: String(dashboardSummary.draft),
      note: "需要继续补充",
      tone: "amber",
    },
    {
      label: "资料完整",
      value: String(dashboardSummary.completed),
      note: `完整率 ${completionRate}%`,
      tone: "violet",
    },
    {
      label: "客户待办",
      value: String(openTaskCount),
      note: "手机电脑同步",
      tone: "blue",
    },
  ];

  return (
    <div className="workspace-shell">
      <aside className="desktop-sidebar" aria-label="主导航">
        <Link href="/" className="brand-mark" aria-label="销客工作台首页">
          <span className="brand-symbol">销</span>
          <span><strong>销客</strong><small>销售工作台</small></span>
        </Link>

        <nav className="side-nav">
          <span className="nav-label">工作台</span>
          <Link href="/" className="nav-item active"><House size={19} />首页</Link>
          <Link href="/customers" className="nav-item"><UsersRound size={19} />客户<span className="nav-count">{dashboardSummary.total}</span></Link>
          <Link href="/customers/new" className="nav-item"><UserPlus size={19} />新增客户</Link>
          <button type="button" className="nav-item" onClick={focusMerchantSearch}><Store size={19} />搜索商户</button>
          <span className="nav-label second">常用</span>
          <Link href="/customers?status=draft" className="nav-item"><ClipboardCheck size={19} />资料待补</Link>
          <Link href="/tasks" className="nav-item"><CalendarCheck2 size={19} />客户待办</Link>
          <Link href="/customers/trash" className="nav-item"><Archive size={19} />客户回收站</Link>
          <Link href="/activity" className="nav-item"><History size={19} />操作记录</Link>
          <Link href="/settings/data" className="nav-item"><DatabaseBackup size={19} />备份与恢复</Link>
        </nav>

        <div className="sidebar-help">
          <Sparkles size={18} />
          <strong>录入快，找人快</strong>
          <span>支持姓名、手机号、店铺名字与商户信息全局搜索</span>
        </div>

        <div className="sidebar-profile" aria-label="当前用户">
          <span className="avatar avatar-small">林</span>
          <span><strong>个人工作台</strong><small>云端同步模式</small></span>
          <LockKeyhole size={16} />
        </div>
      </aside>

      <main className="workspace-main">
        <header className="mobile-brandbar">
          <Link href="/" className="brand-mark">
            <span className="brand-symbol">销</span><strong>销客</strong>
          </Link>
          <button className="icon-button" aria-label="通知" type="button" onClick={() => setToast("暂无新通知")}><Bell size={20} /></button>
        </header>

        <header className="desktop-topbar">
          <div className="topbar-title">
            <h1>上午好，林经理</h1>
            <p>今天也从一次高效跟进开始。</p>
          </div>

          <div className={`global-search ${searchFocused ? "focused" : ""}`}>
            <Search size={20} aria-hidden="true" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={(event) => {
                setIsComposing(false);
                setQuery(event.currentTarget.value);
              }}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 160)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveRecentSearch(query);
                if (event.key === "Escape") clearSearch();
              }}
              placeholder={isMobile ? "搜索客户" : "搜索姓名、手机号、商户..."}
              aria-label="全局搜索姓名、手机号或商户"
              autoComplete="off"
            />
            {query ? (
              <button className="search-clear" onClick={clearSearch} aria-label="清空搜索" type="button"><X size={17} /></button>
            ) : (
              <kbd>⌘ K</kbd>
            )}
          </div>

          <div className="topbar-actions">
            <button className="icon-button" aria-label="通知" type="button" onClick={() => setToast("暂无新通知")}><Bell size={20} /></button>
            <Link href="/customers/new" className="primary-button"><Plus size={18} />新增客户</Link>
          </div>
        </header>

        <div className="mobile-search-wrap">
          <div className={`global-search ${searchFocused ? "focused" : ""}`}>
            <Search size={19} aria-hidden="true" />
            <input
              ref={mobileSearchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={(event) => {
                setIsComposing(false);
                setQuery(event.currentTarget.value);
              }}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 160)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveRecentSearch(query);
                if (event.key === "Escape") clearSearch();
              }}
              placeholder="搜索客户"
              aria-label="搜索客户"
              autoComplete="off"
            />
            {query && <button className="search-clear" onClick={clearSearch} aria-label="清空搜索" type="button"><X size={17} /></button>}
          </div>
        </div>

        {showSearchExperience ? (
          <section className="search-view" aria-live="polite">
            {!query.trim() && isMobile ? (
              <div className="recent-panel">
                <div className="section-heading compact">
                  <div><span className="eyebrow">RECENT</span><h2>最近搜索</h2></div>
                  {recentSearches.length > 0 && <button type="button" onClick={clearRecentSearches}>清空搜索记录</button>}
                </div>
                {recentSearches.length > 0 ? (
                  <div className="recent-list">
                    {recentSearches.map((item) => (
                      <button key={item} type="button" onClick={() => setQuery(item)}><Clock3 size={17} />{item}<ChevronRight size={16} /></button>
                    ))}
                  </div>
                ) : (
                  <div className="recent-empty"><Clock3 size={22} /><span>还没有搜索记录</span><small>搜索过的普通关键词会保存在本机</small></div>
                )}
                <div className="privacy-note"><Check size={15} />身份证号码与身份证图片内容不会被记录或搜索</div>
              </div>
            ) : (
              <>
                <div className="search-view-heading">
                  <div>
                    <span className="eyebrow">SEARCH RESULTS</span>
                    <h2>搜索结果</h2>
                    {!loading && !error && <p>{typeof total === "number" ? `找到 ${total} 条相关记录` : `已显示 ${results.length} 条相关记录`}</p>}
                  </div>
                  {demoMode && <span className="demo-badge">演示数据</span>}
                </div>

                {loading || isDebouncing ? (
                  <div className="search-loading"><LoaderCircle className="spin" size={25} /><span>正在查找客户和商户...</span></div>
                ) : error ? (
                  <div className="search-error"><AlertTriangle size={24} /><h3>搜索未完成</h3><p>{error}</p><button type="button" onClick={() => void fetchResults(debouncedQuery)}>重新搜索</button></div>
                ) : results.length === 0 ? (
                  <EmptySearch query={debouncedQuery || query} />
                ) : (
                  <div className="result-groups">
                    {customerResults.length > 0 && (
                      <section className="result-group">
                        <div className="result-group-title"><span className="group-icon customer"><UsersRound size={17} /></span><h3>客户</h3><span>{customerResults.length}</span></div>
                        <div className="result-list">
                          {customerResults.map((customer) => {
                            const status = customer.profileStatus ?? customer.status ?? "draft";
                            const shownPhone = customer.maskedPhone ?? customer.phoneMasked ?? maskPhone(customer.phone);
                            return (
                              <article className="result-card customer-result" key={`customer-${customer.id}`}>
                                <Link href={`/customers/${customer.id}`} className="result-card-main" onClick={() => saveRecentSearch(query)}>
                                  <span className="avatar result-avatar">{customer.name.slice(0, 1)}</span>
                                  <span className="result-identity">
                                    <span className="result-name-row">
                                      <strong>{customer.name}</strong>
                                      {customer.source === "local" && <span className="demo-badge">本机</span>}
                                      {customer.category && <span className="demo-badge">{customer.category}</span>}
                                      <SearchStatus status={status} />
                                    </span>
                                    {customer.shopName && <span className="result-phone">店铺：{customer.shopName}</span>}
                                    <span className="result-phone">{shownPhone}</span>
                                  </span>
                                  <span className="result-date"><small>录入时间</small>{displayDate(customer.createdAt)}</span>
                                  <ChevronRight className="result-chevron" size={18} />
                                </Link>
                                <div className="result-actions" aria-label={`${customer.name}快捷操作`}>
                                  <Link href={`/customers/${customer.id}`} onClick={() => saveRecentSearch(query)}>查看客户</Link>
                                  <button type="button" onClick={() => beginPhoneAction(customer.id, customer.name, "call", customer.source ?? "remote")}><Phone size={15} />拨打电话</button>
                                  <button type="button" onClick={() => beginPhoneAction(customer.id, customer.name, "copy", customer.source ?? "remote")}><Copy size={15} />复制手机号</button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {merchantResults.length > 0 && (
                      <section className="result-group">
                        <div className="result-group-title"><span className="group-icon merchant"><Store size={17} /></span><h3>商户</h3><span>{merchantResults.length}</span></div>
                        <div className="result-list">
                          {merchantResults.map((merchant) => (
                            <article className="result-card merchant-result" key={`merchant-${merchant.id}`}>
                              <div className="result-card-main">
                                <span className="merchant-logo"><Store size={21} /></span>
                                <span className="result-identity">
                                  <span className="result-name-row"><strong>{merchant.merchantName ?? merchant.name}</strong><span className="merchant-status"><i />{merchant.merchantStatus ?? merchant.status ?? "正常"}</span></span>
                                  <span className="merchant-numbers">商户编号：{merchant.merchantNo ?? "—"}<em />终端号：{merchant.terminalNo ?? "—"}</span>
                                </span>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    )}

                    {(visibleSearchCount < results.length || nextCursor || localNextCursor) && (
                      <button className="load-more" type="button" disabled={loadingMore} onClick={() => {
                        if (visibleSearchCount < results.length) {
                          setVisibleSearchCount((current) => current + 20);
                          return;
                        }
                        if (nextCursor || localNextCursor) {
                          void fetchResults(
                            debouncedQuery,
                            nextCursor ?? undefined,
                            localNextCursor ?? undefined,
                          );
                        }
                      }}>
                        {loadingMore ? <><LoaderCircle className="spin" size={17} />正在加载</> : <>加载更多<ArrowRight size={16} /></>}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        ) : (
          <div className="dashboard-content">
            <section className="notice-bar" aria-label="工作台公告">
              <span><Megaphone size={15} />工作台公告</span>
              <p>全局搜索已支持客户与商户统一查找，敏感资料需验证后查看。</p>
              <button type="button" onClick={() => setToast("客户与商户可直接通过顶部搜索框查找")}>查看详情<ChevronRight size={14} /></button>
            </section>

            <section className="welcome-strip">
              <div>
                <span className="eyebrow light">AUGUST · 本月经营概览</span>
                <h2>客户经营数据一目了然</h2>
                <p>当前共有 {dashboardSummary.total} 位客户，{dashboardSummary.draft} 位资料待补，资料完整率 {completionRate}%。</p>
                <Link href="/customers">查看客户数据<ArrowRight size={17} /></Link>
              </div>
              <div className="welcome-orbit" aria-hidden="true">
                <span className="orbit orbit-one" />
                <span className="orbit orbit-two" />
                <span className="welcome-core"><CheckCircle2 size={28} /></span>
                <small className="orbit-label one">资料完整率 {completionRate}%</small>
                <small className="orbit-label two">资料待补 {dashboardSummary.draft}</small>
              </div>
            </section>

            <section className="stats-grid" aria-label="业务概览">
              {statCards.map((card) => (
                <article className={`stat-card ${card.tone}`} key={card.label}>
                  <span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small>
                  <i aria-hidden="true" />
                </article>
              ))}
            </section>

            <section className="follow-up-reminder" aria-label="到期跟进提醒">
              <div className="follow-up-reminder-heading">
                <span><Clock3 size={18} /></span>
                <div><strong>到期跟进</strong><small>{followUps.totalDue ? `今天需处理 ${followUps.totalDue} 位客户${followUps.overdue ? `，其中 ${followUps.overdue} 位已逾期` : ""}` : "今天没有到期客户"}</small></div>
                <Link href="/tasks">安排待办<ChevronRight size={15} /></Link>
              </div>
              {followUps.items.length > 0 && <div className="follow-up-reminder-list">{followUps.items.slice(0, 4).map((item) => <Link href={`/customers/${item.id}`} key={item.id}><span className="avatar avatar-small">{item.name.slice(0, 1)}</span><span><strong>{item.name}</strong><small>{item.overdue ? "已逾期" : "今天"} · {new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(item.nextFollowUpAt))}</small></span><ChevronRight size={15} /></Link>)}</div>}
            </section>

            <div className="dashboard-grid">
              <section className="panel recent-customers-panel">
                <div className="section-heading">
                  <div><span className="eyebrow">LATEST</span><h2>最近录入</h2></div>
                  <Link href="/customers">全部客户<ChevronRight size={16} /></Link>
                </div>
                <div className="recent-customer-list">
                  {recentCustomerRows.map((customer) => (
                    <Link href={`/customers/${customer.id}`} className="recent-customer" key={customer.id}>
                      <span className="avatar">{customer.name.slice(0, 1)}</span>
                      <span className="recent-info"><strong>{customer.name}</strong><small>{customer.phone} · {customer.category}</small></span>
                      <SearchStatus status={customer.status ?? "draft"} />
                      <span className="recent-source"><small>{customer.source}</small>{customer.time}</span>
                      <ChevronRight size={17} />
                    </Link>
                  ))}
                  {recentCustomerRows.length === 0 && (
                    <div className="recent-empty">
                      <UserPlus size={24} />
                      <span>还没有客户资料</span>
                      <small>点击“新增客户”开始录入第一位客户</small>
                    </div>
                  )}
                </div>
              </section>

              <aside className="dashboard-aside">
                <section className="panel quick-panel">
                  <div className="section-heading"><div><span className="eyebrow">QUICK START</span><h2>快捷操作</h2></div></div>
                  <div className="quick-actions">
                    <Link href="/customers/new" className="quick-action primary"><span><UserPlus size={21} /></span><strong>新增客户</strong><small>30–60 秒快速录入</small><ChevronRight size={17} /></Link>
                    <Link href="/customers" className="quick-action"><span><Search size={21} /></span><strong>查找客户</strong><small>姓名或手机号</small><ChevronRight size={17} /></Link>
                    <Link href="/tasks" className="quick-action"><span><CalendarCheck2 size={21} /></span><strong>客户待办</strong><small>安排跟进事项</small><ChevronRight size={17} /></Link>
                    <button type="button" className="quick-action" onClick={focusMerchantSearch}><span><Store size={21} /></span><strong>搜索商户</strong><small>名称、编号或终端号</small><ChevronRight size={17} /></button>
                    <Link href="/settings/data" className="quick-action"><span><DatabaseBackup size={21} /></span><strong>导出与恢复</strong><small>含身份证正反面图片</small><ChevronRight size={17} /></Link>
                  </div>
                </section>

                <section className="panel completeness-panel">
                  <div className="completion-top"><span>资料完整率</span><strong>{completionRate}%</strong></div>
                  <div className="completion-track"><i style={{ width: `${completionRate}%` }} /></div>
                  <p>还有 <strong>{dashboardSummary.draft} 位客户</strong> 的资料需要补充</p>
                  <Link href="/customers?status=draft">立即处理<ArrowRight size={15} /></Link>
                </section>
              </aside>
            </div>
          </div>
        )}
      </main>

      <nav className="mobile-bottom-nav" aria-label="移动端主导航">
        <Link href="/" className="active"><House size={20} /><span>首页</span></Link>
        <Link href="/customers"><UsersRound size={20} /><span>客户</span></Link>
        <Link href="/customers/new" className="mobile-add" aria-label="新增客户"><Plus size={25} /></Link>
        <Link href="/tasks"><CalendarCheck2 size={20} /><span>待办</span></Link>
      </nav>

      {toast && <div className="toast-message" role="status"><Check size={17} />{toast}</div>}

      {phoneAction && (
        <div className="secure-action-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closePhoneAction();
        }}>
          <form className="secure-action-dialog" onSubmit={(event) => {
            event.preventDefault();
            void performPhoneAction();
          }} role="dialog" aria-modal="true" aria-labelledby="secure-phone-title">
            <div className="secure-dialog-icon"><LockKeyhole size={21} /></div>
            <button type="button" className="secure-dialog-close" onClick={closePhoneAction} aria-label="关闭"><X size={18} /></button>
            <span className="eyebrow">SENSITIVE ACCESS</span>
            <h2 id="secure-phone-title">验证后{phoneAction.kind === "call" ? "拨打" : "复制"}手机号</h2>
            <p>请输入敏感资料验证密码，系统将重新校验你对“{phoneAction.customerName}”的查看权限。</p>
            <label htmlFor="phone-action-password">验证密码</label>
            <input
              id="phone-action-password"
              ref={phonePasswordInputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={phonePassword}
              onChange={(event) => {
                setPhonePassword(event.target.value);
                setPhoneActionError("");
              }}
              placeholder="请输入验证密码"
            />
            {phoneActionError && <div className="secure-action-error" role="alert">{phoneActionError}</div>}
            <div className="secure-dialog-actions">
              <button type="button" onClick={closePhoneAction}>取消</button>
              <button type="submit" disabled={phoneActionLoading || !phonePassword}>
                {phoneActionLoading ? <><LoaderCircle className="spin" size={16} />正在验证</> : "验证并继续"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
