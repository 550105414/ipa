"use client";

import {
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getLocalCustomer,
  LOCAL_CUSTOMER_CATEGORIES,
  revokeLocalCustomerAccess,
  unlockLocalCustomer,
  updateLocalBankCard,
  updateLocalCustomerCategory,
  watchLocalVaultSessionLifecycle,
  type LocalCustomerAccess,
  type LocalCustomerCategory,
  type LocalCustomerSummary,
  type LocalVaultSession,
} from "@/lib/local-vault";
import {
  CUSTOMER_MACHINE_MODES,
  CUSTOMER_MACHINE_TYPES,
  isCustomerMachineMode,
  isCustomerMachineType,
  isValidCustomerFeeRate,
  type CustomerMachineMode,
  type CustomerMachineType,
} from "@/lib/customers/machine";
import {
  bankCardDigits,
  formatBankCardNumber,
  isValidBankCardNumber,
} from "../bank-card";
import {
  clearRememberedLocalVaultSession,
  getLocalVaultScope,
  unlockLocalVaultSession,
} from "../local-vault-session";
import { apiErrorMessage, customerRequestHeaders } from "../request";
import type {
  BankCardUpdateResponse,
  CustomerDetail,
  CustomerSensitiveData,
  ProfileStatus,
} from "../types";

const SENSITIVE_ACCESS_DURATION_MS = 5 * 60 * 1000;

function Link({ children, ...props }: ComponentPropsWithoutRef<"a">) {
  return <a {...props}>{children}</a>;
}

type RawCustomerDetail = {
  id?: unknown;
  name?: unknown;
  maskedPhone?: unknown;
  profileStatus?: unknown;
  createdAt?: unknown;
  idCard?: {
    frontUploaded?: unknown;
    backUploaded?: unknown;
  };
  idFrontPresent?: unknown;
  idBackPresent?: unknown;
  shopName?: unknown;
  merchantName?: unknown;
  notes?: unknown;
  category?: unknown;
  nextFollowUpAt?: unknown;
  machineType?: unknown;
  machineMode?: unknown;
  feeRate?: unknown;
};

async function readResponse<T>(
  response: Response,
  fallbackError: string,
): Promise<T> {
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    throw new Error(apiErrorMessage(payload, fallbackError));
  }
  if (!payload) throw new Error(fallbackError);
  return payload;
}

function normalizeCustomer(
  value: RawCustomerDetail,
  fallbackId: string,
): CustomerDetail {
  const idCard = value.idCard;
  return {
    id: typeof value.id === "string" ? value.id : fallbackId,
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name
        : "未命名客户",
    maskedPhone:
      typeof value.maskedPhone === "string" && value.maskedPhone.trim()
        ? value.maskedPhone
        : "手机号已保护",
    profileStatus: value.profileStatus === "completed" ? "completed" : "draft",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    idCard: {
      frontUploaded: Boolean(
        idCard?.frontUploaded ?? value.idFrontPresent,
      ),
      backUploaded: Boolean(idCard?.backUploaded ?? value.idBackPresent),
    },
    shopName: typeof value.shopName === "string" ? value.shopName : null,
    merchantName:
      typeof value.merchantName === "string" ? value.merchantName : null,
    notes: typeof value.notes === "string" ? value.notes : null,
    category: LOCAL_CUSTOMER_CATEGORIES.includes(
      value.category as LocalCustomerCategory,
    )
      ? (value.category as LocalCustomerCategory)
      : "直营",
    nextFollowUpAt:
      typeof value.nextFollowUpAt === "string" ? value.nextFollowUpAt : null,
    machineType: isCustomerMachineType(value.machineType) ? value.machineType : null,
    machineMode: isCustomerMachineMode(value.machineMode) ? value.machineMode : null,
    feeRate: isValidCustomerFeeRate(value.feeRate) ? value.feeRate : null,
  };
}

async function getCustomer(
  customerId: string,
  signal: AbortSignal,
): Promise<CustomerDetail | null> {
  const response = await fetch(
    `/api/customers/${encodeURIComponent(customerId)}`,
    {
      cache: "no-store",
      headers: customerRequestHeaders(),
      signal,
    },
  );
  if (response.status === 404) return null;
  const payload = await readResponse<{ customer?: RawCustomerDetail }>(
    response,
    "无法读取客户资料",
  );
  if (!payload.customer || typeof payload.customer !== "object") {
    throw new Error("客户资料格式无效");
  }

  // Only copy explicitly non-sensitive fields into component state. This
  // protects the locked view if an older API happens to return extra fields.
  return normalizeCustomer(payload.customer, customerId);
}

function localSummaryToCustomer(
  customer: LocalCustomerSummary,
): CustomerDetail {
  return {
    id: customer.id,
    name: customer.name,
    shopName: customer.shopName ?? null,
    maskedPhone: customer.maskedPhone,
    profileStatus: customer.profileStatus,
    category: customer.category,
    machineType: customer.machineType ?? null,
    machineMode: customer.machineMode ?? null,
    feeRate: customer.feeRate ?? null,
    createdAt: customer.createdAt,
    idCard: {
      frontUploaded: customer.idCard.frontUploaded,
      backUploaded: customer.idCard.backUploaded,
    },
  };
}

function normalizeSensitiveData(value: CustomerSensitiveData): CustomerSensitiveData {
  return {
    phone: typeof value.phone === "string" ? value.phone : "",
    idCard: {
      frontUrl:
        typeof value.idCard?.frontUrl === "string"
          ? value.idCard.frontUrl
          : null,
      backUrl:
        typeof value.idCard?.backUrl === "string"
          ? value.idCard.backUrl
          : null,
    },
    bankCardNumber:
      typeof value.bankCardNumber === "string"
        ? bankCardDigits(value.bankCardNumber)
        : null,
    demoMode: value.demoMode,
  };
}

function formatDate(value: string | null): string {
  if (!value) return "时间未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function statusCopy(status: ProfileStatus): {
  label: string;
  description: string;
} {
  if (status === "completed") {
    return {
      label: "资料完整",
      description: "姓名、手机号及身份证正反面均已录入。",
    };
  }
  return {
    label: "资料待补",
    description: "仍有必填资料未录入，请及时补充。",
  };
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const field = document.createElement("textarea");
  field.value = value;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("复制失败");
}

export function CustomerDetailClient({ customerId }: { customerId: string }) {
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [isLocalCustomer, setIsLocalCustomer] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const [password, setPassword] = useState("");
  const [sensitiveData, setSensitiveData] =
    useState<CustomerSensitiveData | null>(null);
  const [sensitiveError, setSensitiveError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [categoryInput, setCategoryInput] =
    useState<LocalCustomerCategory>("直营");
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [categoryMessage, setCategoryMessage] = useState<string | null>(null);
  const [followUpInput, setFollowUpInput] = useState("");
  const [isSavingFollowUp, setIsSavingFollowUp] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState<string | null>(null);
  const [shopNameInput, setShopNameInput] = useState("");
  const [isSavingShopName, setIsSavingShopName] = useState(false);
  const [shopNameMessage, setShopNameMessage] = useState<string | null>(null);
  const [machineTypeInput, setMachineTypeInput] = useState<"" | CustomerMachineType>("");
  const [machineModeInput, setMachineModeInput] = useState<"" | CustomerMachineMode>("");
  const [feeRateInput, setFeeRateInput] = useState("");
  const [isSavingMachine, setIsSavingMachine] = useState(false);
  const [machineMessage, setMachineMessage] = useState<string | null>(null);
  const [isDeletingCustomer, setIsDeletingCustomer] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const sensitiveRequest = useRef<AbortController | null>(null);
  const sensitiveExpiryTimer = useRef<number | null>(null);
  const sensitiveExpiresAt = useRef<number | null>(null);
  const localAccess = useRef<LocalCustomerAccess | null>(null);

  const localSession = useRef<LocalVaultSession | null>(null);
  const localSessionLifecycleCleanup = useRef<(() => void) | null>(null);

  const [isEditingBankCard, setIsEditingBankCard] = useState(false);
  const [bankCardInput, setBankCardInput] = useState("");
  const [bankCardMessage, setBankCardMessage] = useState<string | null>(null);
  const [isSavingBankCard, setIsSavingBankCard] = useState(false);
  const bankCardRequest = useRef<AbortController | null>(null);
  const [supplementFront, setSupplementFront] = useState<File | null>(null);
  const [supplementBack, setSupplementBack] = useState<File | null>(null);
  const [isSavingIdCard, setIsSavingIdCard] = useState(false);
  const [idCardMessage, setIdCardMessage] = useState<string | null>(null);
  const [idCardFormKey, setIdCardFormKey] = useState(0);

  const clearSensitiveAccess = useCallback(() => {
    sensitiveRequest.current?.abort();
    sensitiveRequest.current = null;
    bankCardRequest.current?.abort();
    bankCardRequest.current = null;
    if (sensitiveExpiryTimer.current !== null) {
      window.clearTimeout(sensitiveExpiryTimer.current);
      sensitiveExpiryTimer.current = null;
    }
    localSessionLifecycleCleanup.current?.();
    localSessionLifecycleCleanup.current = null;
    if (localAccess.current) {
      revokeLocalCustomerAccess(localAccess.current);
      localAccess.current = null;
    }
    if (localSession.current) {
      clearRememberedLocalVaultSession();
      localSession.current = null;
    }
    sensitiveExpiresAt.current = null;
    setPassword("");
    setSensitiveData(null);
    setSensitiveError(null);
    setIsUnlocking(false);
    setCopyState("idle");
    setIsEditingBankCard(false);
    setBankCardInput("");
    setBankCardMessage(null);
    setIsSavingBankCard(false);
    setSupplementFront(null);
    setSupplementBack(null);
    setIsSavingIdCard(false);
    setIdCardMessage(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCustomer() {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      clearSensitiveAccess();
      setIsLoading(true);
      setCustomer(null);
      setError(null);
      setIsLocalCustomer(false);
      try {
        const cloudCustomer = customerId.startsWith("local_")
          ? null
          : await getCustomer(customerId, controller.signal);
        if (controller.signal.aborted) return;
        if (cloudCustomer) {
          setCategoryInput(cloudCustomer.category ?? "直营");
          setFollowUpInput(toDateTimeLocal(cloudCustomer.nextFollowUpAt));
          setShopNameInput(cloudCustomer.shopName ?? "");
          setMachineTypeInput(cloudCustomer.machineType ?? "");
          setMachineModeInput(cloudCustomer.machineMode ?? "");
          setFeeRateInput(cloudCustomer.feeRate === null || cloudCustomer.feeRate === undefined ? "" : String(cloudCustomer.feeRate));
          setCustomer(cloudCustomer);
          setIsUnlocking(true);
          setSensitiveError(null);
          try {
            const response = await fetch(
              `/api/customers/${encodeURIComponent(customerId)}/sensitive`,
              {
                method: "POST",
                headers: customerRequestHeaders(true),
                body: JSON.stringify({}),
                cache: "no-store",
                signal: controller.signal,
              },
            );
            const result = await readResponse<CustomerSensitiveData>(
              response,
              "完整客户资料读取失败，请稍后重试",
            );
            if (!controller.signal.aborted) {
              setSensitiveData(normalizeSensitiveData(result));
            }
          } catch (sensitiveLoadError: unknown) {
            if (!controller.signal.aborted) {
              setSensitiveError(
                sensitiveLoadError instanceof Error
                  ? sensitiveLoadError.message
                  : "完整客户资料读取失败，请稍后重试",
              );
            }
          } finally {
            if (!controller.signal.aborted) setIsUnlocking(false);
          }
          return;
        }

        const scope = await getLocalVaultScope(controller.signal);
        if (controller.signal.aborted) return;
        const localCustomer = scope
          ? await getLocalCustomer(customerId, scope)
          : null;
        if (controller.signal.aborted) return;
        if (!localCustomer) {
          throw new Error("该客户不存在，或你没有查看权限。");
        }
        setCategoryInput(localCustomer.category);
        setShopNameInput(localCustomer.shopName ?? "");
        setMachineTypeInput(localCustomer.machineType ?? "");
        setMachineModeInput(localCustomer.machineMode ?? "");
        setFeeRateInput(localCustomer.feeRate === null || localCustomer.feeRate === undefined ? "" : String(localCustomer.feeRate));
        setCustomer(localSummaryToCustomer(localCustomer));
        setIsLocalCustomer(true);
      } catch (loadError: unknown) {
        if (controller.signal.aborted) return;
        setCustomer(null);
        setError(
          loadError instanceof Error ? loadError.message : "无法读取客户资料",
        );
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadCustomer();

    return () => controller.abort();
  }, [clearSensitiveAccess, customerId, retryToken]);

  useEffect(
    () => () => {
      sensitiveRequest.current?.abort();
      bankCardRequest.current?.abort();
      if (sensitiveExpiryTimer.current !== null) {
        window.clearTimeout(sensitiveExpiryTimer.current);
      }
      localSessionLifecycleCleanup.current?.();
      localSessionLifecycleCleanup.current = null;
      if (localAccess.current) {
        revokeLocalCustomerAccess(localAccess.current);
        localAccess.current = null;
      }
      if (localSession.current) {
        clearRememberedLocalVaultSession();
        localSession.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    const expireIfNeeded = () => {
      if (
        sensitiveExpiresAt.current !== null &&
        Date.now() >= sensitiveExpiresAt.current
      ) {
        clearSensitiveAccess();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") expireIfNeeded();
    };

    window.addEventListener("focus", expireIfNeeded);
    window.addEventListener("pageshow", expireIfNeeded);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", expireIfNeeded);
      window.removeEventListener("pageshow", expireIfNeeded);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [clearSensitiveAccess]);

  async function unlockSensitive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setSensitiveError("请输入验证密码。 ");
      return;
    }

    sensitiveRequest.current?.abort();
    const controller = new AbortController();
    sensitiveRequest.current = controller;
    setIsUnlocking(true);
    setSensitiveError(null);
    let attemptedLocalUnlock = false;

    try {
      let localMatch = isLocalCustomer;
      if (!localMatch) {
        try {
          const scope = await getLocalVaultScope(controller.signal);
          const localSummary = scope
            ? await getLocalCustomer(customerId, scope)
            : null;
          if (localSummary) {
            localMatch = true;
            setCategoryInput(localSummary.category);
            setCustomer(localSummaryToCustomer(localSummary));
            setIsLocalCustomer(true);
          }
        } catch (scopeError) {
          if (customerId.startsWith("local_")) throw scopeError;
          // Cloud customers remain usable if the optional local scope endpoint
          // is unavailable.
        }
      }

      let expiresAt = Date.now() + SENSITIVE_ACCESS_DURATION_MS;
      if (localMatch) {
        attemptedLocalUnlock = true;
        const unlocked = await unlockLocalVaultSession(
          password,
          controller.signal,
        );
        const access = await unlockLocalCustomer(
          customerId,
          unlocked.session,
        );
        if (controller.signal.aborted) {
          revokeLocalCustomerAccess(access);
          clearRememberedLocalVaultSession();
          return;
        }

        localSessionLifecycleCleanup.current?.();
        if (localAccess.current) {
          revokeLocalCustomerAccess(localAccess.current);
        }
        localAccess.current = access;
        localSession.current = unlocked.session;
        expiresAt = unlocked.expiresAt;
        localSessionLifecycleCleanup.current =
          watchLocalVaultSessionLifecycle(unlocked.session, {
            onExpired: clearSensitiveAccess,
          });
        setSensitiveData({
          phone: access.phone,
          idCard: {
            frontUrl: access.idCard.frontUrl,
            backUrl: access.idCard.backUrl,
          },
          bankCardNumber: access.bankCardNumber,
          demoMode: true,
        });
      } else {
        const response = await fetch(
          `/api/customers/${encodeURIComponent(customerId)}/sensitive`,
          {
            method: "POST",
            headers: customerRequestHeaders(true),
            body: JSON.stringify({ password }),
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const result = await readResponse<CustomerSensitiveData>(
          response,
          "验证失败，请检查密码后重试",
        );
        if (controller.signal.aborted) return;
        setSensitiveData(normalizeSensitiveData(result));
      }

      setCopyState("idle");
      setBankCardMessage(null);
      if (sensitiveExpiryTimer.current !== null) {
        window.clearTimeout(sensitiveExpiryTimer.current);
      }
      sensitiveExpiresAt.current = expiresAt;
      sensitiveExpiryTimer.current = window.setTimeout(
        clearSensitiveAccess,
        Math.max(0, expiresAt - Date.now()) + 1,
      );
    } catch {
      if (controller.signal.aborted) return;
      if (attemptedLocalUnlock || localSession.current) {
        localSessionLifecycleCleanup.current?.();
        localSessionLifecycleCleanup.current = null;
        if (localAccess.current) {
          revokeLocalCustomerAccess(localAccess.current);
          localAccess.current = null;
        }
        clearRememberedLocalVaultSession();
        localSession.current = null;
      }
      setPassword("");
      setSensitiveData(null);
      setSensitiveError("验证失败，请检查密码后重试。 ");
    } finally {
      if (sensitiveRequest.current === controller) {
        sensitiveRequest.current = null;
        setIsUnlocking(false);
      }
    }
  }

  async function handleCopyPhone() {
    if (!sensitiveData?.phone) return;
    try {
      await copyText(sensitiveData.phone);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
    }
  }

  function startBankCardEdit() {
    if (!sensitiveData) return;
    setBankCardInput(
      sensitiveData.bankCardNumber
        ? formatBankCardNumber(sensitiveData.bankCardNumber)
        : "",
    );
    setBankCardMessage(null);
    setIsEditingBankCard(true);
  }

  async function saveBankCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cardNumber = bankCardDigits(bankCardInput);
    if (!isValidBankCardNumber(cardNumber)) {
      setBankCardMessage("银行卡号需为 12～19 位数字。 ");
      return;
    }
    if (!sensitiveData || (isLocalCustomer && !password)) {
      setBankCardMessage("客户资料尚未加载完成，请稍后重试。 ");
      return;
    }

    setIsSavingBankCard(true);
    setBankCardMessage(null);
    bankCardRequest.current?.abort();
    const controller = new AbortController();
    bankCardRequest.current = controller;
    try {
      let result: BankCardUpdateResponse;
      if (isLocalCustomer) {
        if (!localSession.current) {
          throw new Error("本机资料库验证状态已失效");
        }
        result = await updateLocalBankCard(
          customerId,
          localSession.current,
          cardNumber,
        );
      } else {
        const response = await fetch(
          `/api/customers/${encodeURIComponent(customerId)}/bank-card`,
          {
            method: "PUT",
            headers: customerRequestHeaders(true),
            body: JSON.stringify({ cardNumber }),
            cache: "no-store",
            signal: controller.signal,
          },
        );
        result = await readResponse<BankCardUpdateResponse>(
          response,
          "银行卡保存失败，请稍后重试",
        );
      }
      if (controller.signal.aborted) return;
      setSensitiveData((current) =>
        current ? { ...current, bankCardNumber: cardNumber } : current,
      );
      setBankCardInput("");
      setIsEditingBankCard(false);
      setBankCardMessage(
        /^\d{4}$/.test(result.last4)
          ? `银行卡已更新（尾号 ${result.last4}）`
          : "银行卡已更新",
      );
    } catch {
      if (controller.signal.aborted) return;
      setBankCardMessage("银行卡保存失败，请稍后重试。 ");
    } finally {
      if (bankCardRequest.current === controller) {
        bankCardRequest.current = null;
        setIsSavingBankCard(false);
      }
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLocalCustomer && (!sensitiveData || !password)) {
      setCategoryMessage("本机档案需要先解锁后再修改客户分类。");
      return;
    }
    setIsSavingCategory(true);
    setCategoryMessage(null);
    try {
      const result = isLocalCustomer
        ? await (() => {
            if (!localSession.current) throw new Error("本机验证已失效");
            return updateLocalCustomerCategory(
              customerId,
              localSession.current,
              categoryInput,
            );
          })()
        : await readResponse<{ category: LocalCustomerCategory }>(
            await fetch(`/api/customers/${encodeURIComponent(customerId)}`, {
              method: "PATCH",
              headers: customerRequestHeaders(true),
              body: JSON.stringify({ category: categoryInput }),
              cache: "no-store",
            }),
            "分类保存失败，请稍后重试",
          );
      setCustomer((current) =>
        current ? { ...current, category: result.category } : current,
      );
      setCategoryMessage("客户分类已保存。");
    } catch {
      setCategoryMessage("分类保存失败，请稍后重试。");
    } finally {
      setIsSavingCategory(false);
    }
  }

  async function saveFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLocalCustomer || isSavingFollowUp) return;
    setIsSavingFollowUp(true);
    setFollowUpMessage(null);
    try {
      const result = await readResponse<{ nextFollowUpAt: string | null }>(
        await fetch(`/api/customers/${encodeURIComponent(customerId)}`, {
          method: "PATCH",
          headers: customerRequestHeaders(true),
          body: JSON.stringify({
            nextFollowUpAt: followUpInput
              ? new Date(followUpInput).toISOString()
              : null,
          }),
          cache: "no-store",
        }),
        "跟进时间保存失败，请稍后重试",
      );
      setCustomer((current) =>
        current ? { ...current, nextFollowUpAt: result.nextFollowUpAt } : current,
      );
      setFollowUpInput(toDateTimeLocal(result.nextFollowUpAt));
      setFollowUpMessage(
        result.nextFollowUpAt ? "下次跟进时间已保存。" : "已清除跟进提醒。",
      );
    } catch {
      setFollowUpMessage("跟进时间保存失败，请稍后重试。 ");
    } finally {
      setIsSavingFollowUp(false);
    }
  }

  async function saveShopName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLocalCustomer || isSavingShopName) return;
    const normalized = shopNameInput.trim();
    if (normalized.length > 120) {
      setShopNameMessage("店铺名字不能超过 120 个字符。");
      return;
    }
    setIsSavingShopName(true);
    setShopNameMessage(null);
    try {
      const result = await readResponse<{ shopName: string | null }>(
        await fetch(`/api/customers/${encodeURIComponent(customerId)}`, {
          method: "PATCH",
          headers: customerRequestHeaders(true),
          body: JSON.stringify({ shopName: normalized || null }),
          cache: "no-store",
        }),
        "店铺名字保存失败，请稍后重试",
      );
      setCustomer((current) =>
        current ? { ...current, shopName: result.shopName } : current,
      );
      setShopNameInput(result.shopName ?? "");
      setShopNameMessage(result.shopName ? "店铺名字已保存。" : "已清空店铺名字。");
    } catch {
      setShopNameMessage("店铺名字保存失败，请稍后重试。");
    } finally {
      setIsSavingShopName(false);
    }
  }

  async function saveMachine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLocalCustomer || isSavingMachine) return;
    const parsedRate = feeRateInput === "" ? null : Number(feeRateInput);
    if (
      machineTypeInput !== "" &&
      (machineModeInput === "" || parsedRate === null || !isValidCustomerFeeRate(parsedRate))
    ) {
      setMachineMessage("请选择购买或赠送，并填写 0～100 之间的费率。");
      return;
    }
    setIsSavingMachine(true);
    setMachineMessage(null);
    try {
      const result = await readResponse<{
        machineType: CustomerMachineType | null;
        machineMode: CustomerMachineMode | null;
        feeRate: number | null;
      }>(
        await fetch(`/api/customers/${encodeURIComponent(customerId)}`, {
          method: "PATCH",
          headers: customerRequestHeaders(true),
          body: JSON.stringify({
            machineType: machineTypeInput || null,
            machineMode: machineTypeInput ? machineModeInput || null : null,
            feeRate: machineTypeInput ? parsedRate : null,
          }),
          cache: "no-store",
        }),
        "机器信息保存失败，请稍后重试",
      );
      setCustomer((current) => current ? { ...current, ...result } : current);
      setMachineTypeInput(result.machineType ?? "");
      setMachineModeInput(result.machineMode ?? "");
      setFeeRateInput(result.feeRate === null ? "" : String(result.feeRate));
      setMachineMessage(result.machineType ? "机器与费率已保存。" : "已清空机器信息。");
    } catch {
      setMachineMessage("机器信息保存失败，请稍后重试。");
    } finally {
      setIsSavingMachine(false);
    }
  }

  async function deleteCustomer() {
    if (!customer || isLocalCustomer || isDeletingCustomer) return;
    if (
      !window.confirm(
        `确定将客户“${customer.name}”移入回收站吗？完整资料会保留 30 天，可随时恢复。`,
      )
    ) {
      return;
    }

    setIsDeletingCustomer(true);
    setDeleteMessage(null);
    try {
      const response = await fetch(
        `/api/customers/${encodeURIComponent(customerId)}`,
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
      clearSensitiveAccess();
      window.location.assign("/customers");
    } catch (caught) {
      setDeleteMessage(
        caught instanceof Error ? caught.message : "删除客户失败，请稍后重试。",
      );
      setIsDeletingCustomer(false);
    }
  }

  function handleSupplementDocument(
    event: ChangeEvent<HTMLInputElement>,
    side: "front" | "back",
  ) {
    const file = event.target.files?.[0] ?? null;
    setIdCardMessage(null);
    if (file && (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024)) {
      setIdCardMessage("请选择 10MB 以内的身份证图片。");
      event.target.value = "";
      return;
    }
    if (side === "front") setSupplementFront(file);
    else setSupplementBack(file);
  }

  async function saveIdCards(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLocalCustomer) {
      setIdCardMessage("旧的本机档案请重新新增到云端后补资料。");
      return;
    }
    if (!sensitiveData) {
      setIdCardMessage("客户资料尚未加载完成，请稍后重试。");
      return;
    }
    if (!supplementFront && !supplementBack) {
      setIdCardMessage("请至少选择一张需要补充或替换的图片。");
      return;
    }
    setIsSavingIdCard(true);
    setIdCardMessage(null);
    const form = new FormData();
    if (supplementFront) form.append("idCardFront", supplementFront, "id-card-front");
    if (supplementBack) form.append("idCardBack", supplementBack, "id-card-back");
    try {
      const response = await fetch(
        `/api/customers/${encodeURIComponent(customerId)}/id-card`,
        {
          method: "PUT",
          headers: customerRequestHeaders(),
          body: form,
          cache: "no-store",
        },
      );
      const result = await readResponse<{
        idCard: { frontUploaded: boolean; backUploaded: boolean };
        profileStatus: ProfileStatus;
      }>(response, "身份证图片保存失败，请稍后重试");
      const version = Date.now();
      setCustomer((current) =>
        current
          ? { ...current, idCard: result.idCard, profileStatus: result.profileStatus }
          : current,
      );
      setSensitiveData((current) =>
        current
          ? {
              ...current,
              idCard: {
                frontUrl: result.idCard.frontUploaded
                  ? `/api/customers/${customerId}/id-card/front?v=${version}`
                  : null,
                backUrl: result.idCard.backUploaded
                  ? `/api/customers/${customerId}/id-card/back?v=${version}`
                  : null,
              },
            }
          : current,
      );
      setSupplementFront(null);
      setSupplementBack(null);
      setIdCardFormKey((value) => value + 1);
      setIdCardMessage(
        result.profileStatus === "completed"
          ? "身份证正反面已补齐，资料状态已更新为完整。"
          : "身份证图片已保存，还需补充另一面。",
      );
    } catch {
      setIdCardMessage("身份证图片保存失败，请检查验证状态后重试。");
    } finally {
      setIsSavingIdCard(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f3f6fb] text-[#172033]">
        <DetailHeader />
        <main
          className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8"
          aria-label="正在加载客户详情"
        >
          <div className="mb-6 h-5 w-24 animate-pulse rounded bg-[#e7ecf5]" />
          <div className="h-56 animate-pulse rounded-xl border border-[#e7ecf5] bg-white" />
          <div className="mt-5 h-72 animate-pulse rounded-xl border border-[#e7ecf5] bg-white" />
        </main>
      </div>
    );
  }

  if (!customer || error) {
    return (
      <div className="min-h-screen bg-[#f3f6fb] text-[#172033]">
        <DetailHeader />
        <main className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
          <div className="rounded-xl border border-[#e6d7ca] bg-white px-6 py-12 shadow-sm">
            <div className="mx-auto grid size-12 place-items-center rounded-xl bg-[#fff1e5] font-bold text-[#94591f]">
              !
            </div>
            <h1 className="mt-5 text-xl font-semibold">无法打开客户详情</h1>
            <p className="mt-2 text-sm leading-6 text-[#667085]">
              {error || "该客户不存在，或你没有查看权限。"}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/customers"
                className="rounded-xl border border-[#d9e2f0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2859d9]"
              >
                返回客户列表
              </Link>
              <button
                type="button"
                onClick={() => {
                  setIsLoading(true);
                  setError(null);
                  setRetryToken((value) => value + 1);
                }}
                className="rounded-xl bg-[#2f6bff] px-4 py-2.5 text-sm font-semibold text-white"
              >
                重新加载
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const status = statusCopy(customer.profileStatus);
  const completed = customer.profileStatus === "completed";
  const checklist = [
    { label: "姓名", value: customer.name.trim() ? "✓ 已录入" : "待补充" },
    { label: "手机号", value: "✓ 已录入" },
    {
      label: "身份证正面",
      value: customer.idCard.frontUploaded ? "✓ 已录入" : "待补充",
    },
    {
      label: "身份证反面",
      value: customer.idCard.backUploaded ? "✓ 已录入" : "待补充",
    },
  ];

  return (
    <div className="min-h-screen bg-[#f3f6fb] text-[#172033]">
      <DetailHeader />

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Link
          href="/customers"
          className="mb-5 inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-medium text-[#5f6b7a] outline-none transition hover:text-[#2f6bff] focus-visible:ring-2 focus-visible:ring-[#2f6bff]"
        >
          <span aria-hidden="true">←</span>
          返回客户列表
        </Link>

        <section className="relative overflow-hidden rounded-xl border border-[#e7ecf5] bg-white px-5 py-6 shadow-[0_2px_10px_rgba(15,23,42,0.05)] sm:px-6 sm:py-7">
          <div className="relative flex flex-col justify-between gap-7 sm:flex-row sm:items-end">
            <div className="flex items-start gap-4 sm:gap-5">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#2f6bff] text-lg font-semibold text-white shadow-sm sm:size-14 sm:text-xl">
                {customer.name.trim().charAt(0) || "客"}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#2f6bff]">
                    Customer profile
                  </p>
                  {isLocalCustomer && (
                    <span className="rounded bg-[#eef4ff] px-2 py-0.5 text-[10px] font-semibold text-[#2f6bff]">
                      本机加密
                    </span>
                  )}
                </div>
                <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] text-[#172033] sm:text-3xl">
                  {customer.name}
                </h1>
                <p className="mt-1.5 font-mono text-sm tracking-wide text-[#667085] sm:text-base">
                  {sensitiveData?.phone || customer.maskedPhone}
                </p>
              </div>
            </div>

            {sensitiveData?.phone ? (
              <div className="flex flex-wrap gap-2">
                <a
                  href={`tel:${sensitiveData.phone.replace(/[^+\d]/g, "")}`}
                  className="rounded-lg bg-[#2f6bff] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#245ae8]"
                >
                  拨打电话
                </a>
                <button
                  type="button"
                  onClick={() => void handleCopyPhone()}
                  className="rounded-lg border border-[#d9e2f0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2f6bff] transition hover:bg-[#eef4ff]"
                >
                  {copyState === "copied"
                    ? "已复制"
                    : copyState === "error"
                      ? "复制失败"
                      : "复制手机号"}
                </button>
                {!isLocalCustomer && (
                  <button
                    type="button"
                    onClick={() => void deleteCustomer()}
                    disabled={isDeletingCustomer}
                    className="rounded-lg border border-[#efc9c4] bg-white px-4 py-2.5 text-sm font-semibold text-[#a23d32] transition hover:bg-[#fff1ef] disabled:cursor-wait disabled:opacity-50"
                  >
                    {isDeletingCustomer ? "正在处理…" : "移入回收站"}
                  </button>
                )}
              </div>
            ) : (
              <a
                href="#sensitive-information"
                className="rounded-lg border border-[#cbdcff] bg-[#eef4ff] px-4 py-2.5 text-sm font-semibold text-[#2f6bff] transition hover:bg-[#e2ecff]"
              >
                {isLocalCustomer ? "解锁后查看完整资料" : "正在加载完整资料"}
              </a>
            )}
          </div>
        </section>

        {deleteMessage && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-[#efc9c4] bg-[#fff7f5] px-4 py-3 text-sm text-[#8f3328]"
          >
            {deleteMessage}
          </p>
        )}

        <section
          id="sensitive-information"
          className="mt-4 scroll-mt-6 rounded-xl border border-[#e7ecf5] bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] sm:p-6"
        >
          {!sensitiveData ? (
            isLocalCustomer ? (
              <div className="grid items-center gap-6 md:grid-cols-[1fr_360px]">
                <div>
                  <div className="grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-lg font-bold text-[#2859d9]">
                    锁
                  </div>
                  <h2 className="mt-4 text-xl font-semibold">本机加密档案</h2>
                  <p className="mt-2 max-w-lg text-xs leading-5 text-[#7a8699]">
                    该旧档案仅在此浏览器中加密保存，需要原本的本机密码才能解锁。
                  </p>
                </div>

                <form onSubmit={unlockSensitive} className="rounded-xl bg-[#f7f9fc] p-4 sm:p-5">
                  <label
                    htmlFor="sensitive-password"
                    className="block text-sm font-semibold text-[#344054]"
                  >
                    本机档案密码
                  </label>
                  <input
                    id="sensitive-password"
                    type="password"
                    autoComplete="current-password"
                    maxLength={128}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setSensitiveError(null);
                    }}
                    placeholder="请输入本机档案密码"
                    className="mt-2 h-12 w-full rounded-xl border border-[#d9e2f0] bg-white px-4 text-base outline-none transition focus:border-[#2f6bff] focus:ring-4 focus:ring-[#2f6bff]/10"
                  />
                  {sensitiveError && (
                    <p role="alert" className="mt-2 text-sm text-[#99502f]">
                      {sensitiveError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={isUnlocking}
                    className="mt-3 h-12 w-full rounded-xl bg-[#2f6bff] text-sm font-semibold text-white shadow-sm transition hover:bg-[#245ae8] disabled:cursor-wait disabled:opacity-60"
                  >
                    {isUnlocking ? "正在解锁…" : "解锁本机档案"}
                  </button>
                </form>
              </div>
            ) : (
              <div className="rounded-xl bg-[#f7f9fc] p-5 sm:p-6">
                <div className="grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-lg font-bold text-[#2859d9]">
                  客
                </div>
                <h2 className="mt-4 text-xl font-semibold">
                  {isUnlocking ? "正在加载完整客户资料" : "完整客户资料暂时无法读取"}
                </h2>
                <p className="mt-2 max-w-lg text-sm leading-6 text-[#667085]">
                  {isUnlocking
                    ? "系统正在按当前登录账号的权限读取手机号、银行卡和身份证资料。"
                    : sensitiveError || "请稍后重新加载。"}
                </p>
                {!isUnlocking && (
                  <button
                    type="button"
                    onClick={() => setRetryToken((current) => current + 1)}
                    className="mt-4 rounded-xl bg-[#2f6bff] px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    重新加载
                  </button>
                )}
              </div>
            )
          ) : (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2f6bff]">
                    Account access
                  </p>
                  <h2 className="mt-2 text-xl font-semibold">完整客户资料</h2>
                  <p className="mt-1 text-sm text-[#667085]">
                    {isLocalCustomer
                      ? "本机加密档案会在 5 分钟后自动锁定。"
                      : "资料已按当前登录账号权限加载，身份证图片不会进入搜索结果。"}
                  </p>
                </div>
                {isLocalCustomer && (
                  <button
                    type="button"
                    onClick={clearSensitiveAccess}
                    className="rounded-xl border border-[#d9e2f0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2859d9] transition hover:bg-[#f7f9fc]"
                  >
                    锁定本机档案
                  </button>
                )}
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-[#e7ecf5] bg-[#f8faff] p-5">
                  <p className="text-xs font-semibold text-[#7a8699]">完整手机号</p>
                  <p className="mt-2 break-all font-mono text-lg font-semibold tracking-wide text-[#263247]">
                    {sensitiveData.phone || "未录入"}
                  </p>
                </div>

                <div className="rounded-xl border border-[#e7ecf5] bg-[#f8faff] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-[#7a8699]">完整银行卡号</p>
                      <p className="mt-2 break-all font-mono text-base font-semibold tracking-wide text-[#263247]">
                        {sensitiveData.bankCardNumber
                          ? formatBankCardNumber(sensitiveData.bankCardNumber)
                          : "尚未录入"}
                      </p>
                    </div>
                    {!isEditingBankCard && (
                      <button
                        type="button"
                        onClick={startBankCardEdit}
                        className="shrink-0 rounded-lg border border-[#d9e2f0] bg-white px-3 py-2 text-xs font-semibold text-[#2859d9]"
                      >
                        {sensitiveData.bankCardNumber ? "修改" : "录入"}
                      </button>
                    )}
                  </div>

                  {isEditingBankCard && (
                    <form onSubmit={saveBankCard} className="mt-4 border-t border-[#e7ecf5] pt-4">
                      <label
                        htmlFor="bank-card-number"
                        className="text-xs font-semibold text-[#5f6b7a]"
                      >
                        银行卡号
                      </label>
                      <input
                        id="bank-card-number"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={23}
                        value={bankCardInput}
                        onChange={(event) => {
                          setBankCardInput(
                            formatBankCardNumber(event.target.value),
                          );
                          setBankCardMessage(null);
                        }}
                        placeholder="输入 12～19 位银行卡号"
                        aria-describedby="bank-card-guidance"
                        className="mt-2 h-11 w-full rounded-xl border border-[#d9e2f0] bg-white px-3 font-mono text-sm tracking-wide outline-none focus:border-[#2f6bff] focus:ring-4 focus:ring-[#2f6bff]/10"
                      />
                      <p
                        id="bank-card-guidance"
                        className="mt-2 text-xs leading-5 text-[#7a8699]"
                      >
                        仅填写银行卡号。绝不要填写 CVV、安全码、PIN 或银行卡密码。
                      </p>
                      {bankCardInput && !isValidBankCardNumber(bankCardInput) && (
                        <p className="mt-2 text-xs text-[#99502f]">
                          请输入 12～19 位银行卡号。
                        </p>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditingBankCard(false);
                            setBankCardInput("");
                            setBankCardMessage(null);
                          }}
                          className="h-10 flex-1 rounded-lg border border-[#d9e2f0] bg-white text-xs font-semibold text-[#5f6b7a]"
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          disabled={
                            !isValidBankCardNumber(bankCardInput) ||
                            isSavingBankCard
                          }
                          className="h-10 flex-[1.4] rounded-lg bg-[#2f6bff] text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSavingBankCard ? "正在保存…" : "保存银行卡"}
                        </button>
                      </div>
                    </form>
                  )}
                  {bankCardMessage && (
                    <p
                      role="status"
                      className="mt-3 text-xs leading-5 text-[#5f6b7a]"
                    >
                      {bankCardMessage}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6">
                <h3 className="text-sm font-semibold">身份证图片</h3>
                <p className="mt-1 text-xs text-[#7a8699]">
                  仅在当前登录账号的客户详情中显示，不进入搜索结果。
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <SensitiveImage
                    title="身份证正面"
                    url={sensitiveData.idCard.frontUrl}
                    alt={`${customer.name}的身份证正面图片`}
                  />
                  <SensitiveImage
                    title="身份证反面"
                    url={sensitiveData.idCard.backUrl}
                    alt={`${customer.name}的身份证反面图片`}
                  />
                </div>
                <form
                  key={idCardFormKey}
                  onSubmit={saveIdCards}
                  className="mt-4 rounded-xl border border-[#d9e4fb] bg-[#f8faff] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-[#344054]">补充或替换身份证图片</h4>
                      <p className="mt-1 text-xs leading-5 text-[#7a8699]">手机拍照后保存，电脑端会自动同步显示。</p>
                    </div>
                    <span className="rounded-full bg-[#eaf1ff] px-3 py-1 text-[11px] font-semibold text-[#2859d9]">云端加密访问</span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="rounded-xl border border-dashed border-[#bfcde2] bg-white p-3 text-xs font-semibold text-[#526071]">
                      身份证正面
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => handleSupplementDocument(event, "front")}
                        className="mt-2 block w-full text-xs font-normal file:mr-2 file:rounded-lg file:border-0 file:bg-[#eef4ff] file:px-3 file:py-2 file:font-semibold file:text-[#2859d9]"
                      />
                    </label>
                    <label className="rounded-xl border border-dashed border-[#bfcde2] bg-white p-3 text-xs font-semibold text-[#526071]">
                      身份证反面
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => handleSupplementDocument(event, "back")}
                        className="mt-2 block w-full text-xs font-normal file:mr-2 file:rounded-lg file:border-0 file:bg-[#eef4ff] file:px-3 file:py-2 file:font-semibold file:text-[#2859d9]"
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={isSavingIdCard || (!supplementFront && !supplementBack)}
                    className="mt-3 h-11 w-full rounded-xl bg-[#2f6bff] text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingIdCard ? "正在保存并同步…" : "保存身份证资料"}
                  </button>
                  {idCardMessage && (
                    <p role="status" className="mt-2 text-xs leading-5 text-[#5f6b7a]">{idCardMessage}</p>
                  )}
                </form>
              </div>
            </div>
          )}
        </section>

        <div className="mt-4 grid gap-4 md:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-xl border border-[#e7ecf5] bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7a8699]">
                  Profile status
                </p>
                <h2 className="mt-2 text-xl font-semibold">资料状态</h2>
              </div>
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  completed
                    ? "bg-[#eaf1ff] text-[#2859d9]"
                    : "bg-[#fff1df] text-[#94591f]"
                }`}
              >
                <span aria-hidden="true">{completed ? "✓" : "!"}</span>
                {status.label}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#667085]">
              {status.description}
            </p>

            <ul className="mt-6 space-y-3" aria-label="客户资料项目">
              {checklist.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center justify-between rounded-xl bg-[#f7f9fc] px-4 py-3"
                >
                  <span className="text-sm font-medium text-[#344054]">
                    {item.label}
                  </span>
                  <span className="text-xs font-semibold text-[#667085]">
                    {item.value}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-[#e7ecf5] bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7a8699]">
              Record details
            </p>
            <h2 className="mt-2 text-xl font-semibold">档案信息</h2>

            <dl className="mt-6 divide-y divide-[#edf1f7]">
              <div className="flex items-start justify-between gap-4 py-4 first:pt-0">
                <dt className="text-sm text-[#7a8699]">客户编号</dt>
                <dd className="max-w-[65%] break-all text-right font-mono text-sm font-medium text-[#344054]">
                  {customer.id}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4 py-4">
                <dt className="text-sm text-[#7a8699]">录入时间</dt>
                <dd className="text-right text-sm font-medium text-[#344054]">
                  {formatDate(customer.createdAt)}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4 py-4">
                <dt className="text-sm text-[#7a8699]">客户分类</dt>
                <dd className="rounded-full bg-[#f1ecff] px-3 py-1 text-right text-xs font-semibold text-[#6d4bc3]">
                  {customer.category ?? "直营"}
                </dd>
              </div>
              {customer.shopName && (
                <div className="flex items-start justify-between gap-4 py-4">
                  <dt className="text-sm text-[#7a8699]">店铺名字</dt>
                  <dd className="text-right text-sm font-medium text-[#344054]">
                    {customer.shopName}
                  </dd>
                </div>
              )}
              {customer.machineType && (
                <>
                  <div className="flex items-start justify-between gap-4 py-4">
                    <dt className="text-sm text-[#7a8699]">机器</dt>
                    <dd className="text-right text-sm font-medium text-[#344054]">{customer.machineType}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4 py-4">
                    <dt className="text-sm text-[#7a8699]">机器模式</dt>
                    <dd className="text-right text-sm font-medium text-[#344054]">{customer.machineMode}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4 py-4">
                    <dt className="text-sm text-[#7a8699]">费率</dt>
                    <dd className="text-right text-sm font-semibold text-[#2f6bff]">{customer.feeRate}%</dd>
                  </div>
                </>
              )}
              {customer.merchantName && (
                <div className="flex items-start justify-between gap-4 py-4">
                  <dt className="text-sm text-[#7a8699]">关联商户</dt>
                  <dd className="text-right text-sm font-medium text-[#344054]">
                    {customer.merchantName}
                  </dd>
                </div>
              )}
            </dl>

            <form
              onSubmit={saveShopName}
              className="mt-5 rounded-xl border border-[#d9e4fb] bg-[#f8faff] p-4"
            >
              <label htmlFor="detail-shop-name" className="text-xs font-semibold text-[#7a8699]">
                店铺名字
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="detail-shop-name"
                  type="text"
                  maxLength={120}
                  value={shopNameInput}
                  onChange={(event) => {
                    setShopNameInput(event.target.value);
                    setShopNameMessage(null);
                  }}
                  disabled={isLocalCustomer}
                  placeholder="填写或修改店铺名字"
                  className="h-10 flex-1 rounded-lg border border-[#d9e2f0] bg-white px-3 text-sm outline-none focus:border-[#2f6bff] disabled:opacity-50"
                />
                <button type="submit" disabled={isLocalCustomer || isSavingShopName} className="h-10 rounded-lg bg-[#2f6bff] px-4 text-sm font-semibold text-white disabled:opacity-50">
                  {isSavingShopName ? "正在保存…" : "保存店铺名字"}
                </button>
              </div>
              {shopNameMessage && <p role="status" className="mt-2 text-xs text-[#5f6b7a]">{shopNameMessage}</p>}
            </form>

            <form
              onSubmit={saveMachine}
              className="mt-5 rounded-xl border border-[#d9e4fb] bg-[#f8faff] p-4"
            >
              <p className="text-xs font-semibold text-[#7a8699]">机器与费率</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <select
                  aria-label="机器"
                  value={machineTypeInput}
                  disabled={isLocalCustomer}
                  onChange={(event) => {
                    const value = event.target.value as "" | CustomerMachineType;
                    setMachineTypeInput(value);
                    if (!value) {
                      setMachineModeInput("");
                      setFeeRateInput("");
                    }
                    setMachineMessage(null);
                  }}
                  className="h-10 rounded-lg border border-[#d9e2f0] bg-white px-3 text-sm outline-none focus:border-[#2f6bff] disabled:opacity-50"
                >
                  <option value="">无机器</option>
                  {CUSTOMER_MACHINE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select
                  aria-label="机器模式"
                  value={machineModeInput}
                  disabled={isLocalCustomer || !machineTypeInput}
                  onChange={(event) => {
                    setMachineModeInput(event.target.value as "" | CustomerMachineMode);
                    setMachineMessage(null);
                  }}
                  className="h-10 rounded-lg border border-[#d9e2f0] bg-white px-3 text-sm outline-none focus:border-[#2f6bff] disabled:opacity-50"
                >
                  <option value="">购买/赠送</option>
                  {CUSTOMER_MACHINE_MODES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <div className="relative">
                  <input
                    aria-label="费率"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={feeRateInput}
                    disabled={isLocalCustomer || !machineTypeInput}
                    onChange={(event) => {
                      setFeeRateInput(event.target.value);
                      setMachineMessage(null);
                    }}
                    placeholder="费率"
                    className="h-10 w-full rounded-lg border border-[#d9e2f0] bg-white px-3 pr-8 text-sm outline-none focus:border-[#2f6bff] disabled:opacity-50"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-[#667085]">%</span>
                </div>
                <button type="submit" disabled={isLocalCustomer || isSavingMachine} className="h-10 rounded-lg bg-[#2f6bff] px-4 text-sm font-semibold text-white disabled:opacity-50">
                  {isSavingMachine ? "保存中…" : "保存"}
                </button>
              </div>
              {isLocalCustomer && <p className="mt-2 text-xs text-[#7a8699]">本机旧档案会显示已保存的信息；云端同步启用后可在这里修改。</p>}
              {machineMessage && <p role="status" className="mt-2 text-xs text-[#5f6b7a]">{machineMessage}</p>}
            </form>

            <form
                onSubmit={saveFollowUp}
                className="mt-5 rounded-xl border border-[#d9e4fb] bg-[#f8faff] p-4"
              >
                <label htmlFor="detail-follow-up" className="text-xs font-semibold text-[#7a8699]">
                  下次跟进时间
                </label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="detail-follow-up"
                    type="datetime-local"
                    value={followUpInput}
                    onChange={(event) => {
                      setFollowUpInput(event.target.value);
                      setFollowUpMessage(null);
                    }}
                    disabled={isLocalCustomer}
                    className="h-10 flex-1 rounded-lg border border-[#d9e2f0] bg-white px-3 text-sm outline-none focus:border-[#2f6bff] disabled:opacity-50"
                  />
                  <button type="submit" disabled={isLocalCustomer || isSavingFollowUp} className="h-10 rounded-lg bg-[#2f6bff] px-4 text-sm font-semibold text-white disabled:opacity-50">
                    {isSavingFollowUp ? "正在保存…" : "保存跟进时间"}
                  </button>
                </div>
                {followUpMessage && <p role="status" className="mt-2 text-xs text-[#5f6b7a]">{followUpMessage}</p>}
              </form>

            <form
                onSubmit={saveCategory}
                className="mt-5 rounded-xl border border-[#e7ecf5] bg-[#f8faff] p-4"
              >
                <label
                  htmlFor="detail-customer-category"
                  className="text-xs font-semibold text-[#7a8699]"
                >
                  修改客户分类
                </label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <select
                    id="detail-customer-category"
                    value={categoryInput}
                    onChange={(event) => {
                      setCategoryInput(
                        event.target.value as LocalCustomerCategory,
                      );
                      setCategoryMessage(null);
                    }}
                    className="h-10 flex-1 rounded-lg border border-[#d9e2f0] bg-white px-3 text-sm outline-none focus:border-[#2f6bff]"
                  >
                    {LOCAL_CUSTOMER_CATEGORIES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={(isLocalCustomer && !sensitiveData) || isSavingCategory}
                    className="h-10 rounded-lg bg-[#2f6bff] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isSavingCategory ? "正在保存…" : "保存分类"}
                  </button>
                </div>
                {isLocalCustomer && !sensitiveData && (
                  <p className="mt-2 text-xs text-[#7a8699]">
                    先解锁本机档案，即可修改分类。
                  </p>
                )}
                {categoryMessage && (
                  <p role="status" className="mt-2 text-xs text-[#5f6b7a]">
                    {categoryMessage}
                  </p>
                )}
            </form>

            {customer.notes && (
              <div className="mt-5 rounded-xl border border-[#e7ecf5] bg-[#f8faff] p-4">
                <p className="text-xs font-semibold text-[#7a8699]">跟进备注</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#526071]">
                  {customer.notes}
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function SensitiveImage({
  title,
  url,
  alt,
}: {
  title: string;
  url: string | null;
  alt: string;
}) {
  return (
    <figure className="overflow-hidden rounded-xl border border-[#e7ecf5] bg-[#f7f9fc]">
      <figcaption className="border-b border-[#e7ecf5] bg-white px-4 py-3 text-sm font-semibold text-[#344054]">
        {title}
      </figcaption>
      {url ? (
        // Signed storage URLs are dynamic, so a plain img avoids remote-host
        // allowlisting while preserving the API-provided URL exactly.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="aspect-[1.58/1] w-full object-contain"
        />
      ) : (
        <div className="grid aspect-[1.58/1] place-items-center px-4 text-center text-sm text-[#7a8699]">
          未提供{title}图片
        </div>
      )}
    </figure>
  );
}

function DetailHeader() {
  return (
    <header className="border-b border-[#e7ecf5] bg-white">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f6bff] focus-visible:ring-offset-2"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-[#2f6bff] text-sm font-bold text-white shadow-sm">
            销
          </span>
          <span className="text-sm font-semibold tracking-tight">销售工作台</span>
        </Link>
        <span className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#2f6bff] shadow-sm">
          客户详情
        </span>
      </div>
    </header>
  );
}
