"use client";

import {
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LOCAL_CUSTOMER_CATEGORIES,
  saveLocalCustomer,
  type LocalCustomerCategory,
} from "@/lib/local-vault";
import {
  CUSTOMER_MACHINE_MODES,
  CUSTOMER_MACHINE_TYPES,
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
  LocalVaultUnlockRequestError,
  unlockLocalVaultSession,
} from "../local-vault-session";
import { customerRequestHeaders } from "../request";

type DocumentSide = "front" | "back";
type SubmitPhase =
  | "idle"
  | "verifying"
  | "uploading"
  | "saving"
  | "redirecting";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function Link({ children, ...props }: ComponentPropsWithoutRef<"a">) {
  return <a {...props}>{children}</a>;
}

function createdCustomerId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as {
    id?: unknown;
    customerId?: unknown;
    customer?: { id?: unknown };
  };
  const id = value.customer?.id ?? value.customerId ?? value.id;
  return typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id)
    ? id
    : null;
}

function cloudSaveErrorMessage(status: number): string {
  if (status === 401) return "登录状态已失效，请重新登录后再保存。 ";
  if (status === 403) return "当前账号没有新增客户的权限。 ";
  if (status === 409) {
    return "该手机号可能已经录入，请先返回客户列表搜索确认。 ";
  }
  if (status === 413) return "证件图片过大，请压缩后重新上传。 ";
  if (status === 503) return "客户保存服务暂时不可用，请稍后重试。 ";
  return "客户保存失败，请检查网络后重试。 ";
}

function safeImageFilename(side: DocumentSide, mimeType: string): string {
  const extension =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : mimeType === "image/heic" || mimeType === "image/heif"
          ? "heic"
          : "jpg";
  return `id-card-${side}.${extension}`;
}

function isCloudSaveFallback(error: unknown): boolean {
  return (
    error instanceof LocalVaultUnlockRequestError &&
    error.status === 409 &&
    error.code === "LOCAL_VAULT_DISABLED"
  );
}

export function NewCustomerClient() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [shopName, setShopName] = useState("");
  const [category, setCategory] =
    useState<LocalCustomerCategory>("直营");
  const [machineType, setMachineType] = useState<"" | CustomerMachineType>("");
  const [machineMode, setMachineMode] = useState<"" | CustomerMachineMode>("");
  const [feeRate, setFeeRate] = useState("");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [bankCardNumber, setBankCardNumber] = useState("");
  const [password, setPassword] = useState("");
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [duplicateCustomer, setDuplicateCustomer] = useState<{
    id: string;
    name: string;
    maskedPhone: string;
    inTrash: boolean;
  } | null>(null);
  const [isCheckingPhone, setIsCheckingPhone] = useState(false);
  const requestRef = useRef<AbortController | XMLHttpRequest | null>(null);

  const normalizedPhone = phone.replace(/[\s-]/g, "");
  const nameReady = name.trim().length > 0;
  const phoneReady = /^\+?\d{7,20}$/.test(normalizedPhone);
  const bankCardReady =
    bankCardNumber.length === 0 || isValidBankCardNumber(bankCardNumber);
  const parsedFeeRate = feeRate === "" ? null : Number(feeRate);
  const machineReady =
    machineType === "" ||
    (machineMode !== "" &&
      parsedFeeRate !== null &&
      Number.isFinite(parsedFeeRate) &&
      parsedFeeRate > 0 &&
      parsedFeeRate <= 100);
  const isComplete = Boolean(
    nameReady && phoneReady && frontFile && backFile && bankCardReady,
  );
  const isSubmitting = submitPhase !== "idle";
  const canSubmit =
    nameReady &&
    phoneReady &&
    bankCardReady &&
    machineReady &&
    !duplicateCustomer &&
    !isCheckingPhone;
  const saveProgress =
    submitPhase === "verifying"
      ? 25
      : submitPhase === "uploading"
        ? 25 + Math.round(uploadProgress * 0.65)
      : submitPhase === "saving"
        ? 95
        : submitPhase === "redirecting"
          ? 100
          : 0;

  const completedCount = useMemo(
    () =>
      [nameReady, phoneReady, Boolean(frontFile), Boolean(backFile)].filter(
        Boolean,
      ).length,
    [backFile, frontFile, nameReady, phoneReady],
  );

  useEffect(
    () => () => {
      requestRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!phoneReady) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch("/api/customers/check-phone", {
        method: "POST",
        headers: customerRequestHeaders(true),
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({ phone: normalizedPhone }),
      })
        .then(async (response) =>
          response.ok
            ? ((await response.json()) as {
                duplicate?: boolean;
                customer?: {
                  id: string;
                  name: string;
                  maskedPhone: string;
                  inTrash: boolean;
                };
              })
            : { duplicate: false },
        )
        .then((payload) => {
          if (!controller.signal.aborted) {
            setDuplicateCustomer(
              payload.duplicate && payload.customer ? payload.customer : null,
            );
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setIsCheckingPhone(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedPhone, phoneReady]);

  function handleDocument(event: ChangeEvent<HTMLInputElement>, side: DocumentSide) {
    const file = event.target.files?.[0] ?? null;
    setFileError(null);
    setFormMessage(null);

    if (!file) {
      if (side === "front") setFrontFile(null);
      else setBackFile(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setFileError("请选择图片格式的身份证资料。支持手机拍照或相册图片。 ");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError("单张图片不能超过 10MB，请压缩后重新选择。 ");
      event.target.value = "";
      return;
    }

    if (side === "front") setFrontFile(file);
    else setBackFile(file);
  }

  function uploadCloudCustomer(input: {
    customerName: string;
    customerPhone: string;
    shopName: string | null;
    category: LocalCustomerCategory;
    machineType: CustomerMachineType | null;
    machineMode: CustomerMachineMode | null;
    feeRate: number | null;
    front: File | null;
    back: File | null;
    cardNumber: string | null;
    verificationPassword: string;
    nextFollowUpAt: string | null;
  }): Promise<string> {
    const formData = new FormData();
    formData.append("name", input.customerName);
    formData.append("phone", input.customerPhone);
    if (input.shopName) formData.append("shopName", input.shopName);
    formData.append("category", input.category);
    if (input.machineType) formData.append("machineType", input.machineType);
    if (input.machineMode) formData.append("machineMode", input.machineMode);
    if (input.feeRate !== null) formData.append("feeRate", String(input.feeRate));
    if (input.nextFollowUpAt) {
      formData.append("nextFollowUpAt", input.nextFollowUpAt);
    }
    if (input.front) {
      formData.append(
        "idCardFront",
        input.front,
        safeImageFilename("front", input.front.type),
      );
    }
    if (input.back) {
      formData.append(
        "idCardBack",
        input.back,
        safeImageFilename("back", input.back.type),
      );
    }
    if (input.cardNumber) {
      formData.append("bankCardNumber", input.cardNumber);
    }
    formData.append("password", input.verificationPassword);

    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      requestRef.current = request;
      setSubmitPhase("uploading");
      setUploadProgress(0);
      request.open("POST", "/api/customers");
      request.timeout = 120_000;
      request.setRequestHeader("Accept", "application/json");
      for (const [key, value] of customerRequestHeaders()) {
        request.setRequestHeader(key, value);
      }

      request.upload.onprogress = (progressEvent) => {
        if (requestRef.current !== request || !progressEvent.lengthComputable) {
          return;
        }
        setUploadProgress(
          Math.min(
            100,
            Math.round((progressEvent.loaded / progressEvent.total) * 100),
          ),
        );
      };
      request.upload.onload = () => {
        if (requestRef.current !== request) return;
        setUploadProgress(100);
        setSubmitPhase("saving");
      };
      request.onload = () => {
        if (requestRef.current !== request) return;
        requestRef.current = null;
        if (request.status < 200 || request.status >= 300) {
          reject(new Error(cloudSaveErrorMessage(request.status)));
          return;
        }

        let payload: unknown = null;
        try {
          payload = JSON.parse(request.responseText) as unknown;
        } catch {
          // A successful response still needs a safe id before navigation.
        }
        const customerId = createdCustomerId(payload);
        if (!customerId) {
          reject(
            new Error("客户已提交，但未能打开详情，请返回客户列表确认。 "),
          );
          return;
        }
        resolve(customerId);
      };
      request.onerror = () => {
        if (requestRef.current !== request) return;
        requestRef.current = null;
        reject(new Error("网络连接中断，客户未保存，请重试。 "));
      };
      request.ontimeout = () => {
        if (requestRef.current !== request) return;
        requestRef.current = null;
        reject(new Error("上传超时，客户未保存，请检查网络后重试。 "));
      };
      request.onabort = () => {
        if (requestRef.current === request) requestRef.current = null;
      };
      request.send(formData);
    });
  }

  function finishSuccessfulSave(customerId: string) {
    setPassword("");
    setBankCardNumber("");
    setName("");
    setPhone("");
    setShopName("");
    setCategory("直营");
    setMachineType("");
    setMachineMode("");
    setFeeRate("");
    setNextFollowUpAt("");
    setDuplicateCustomer(null);
    setFrontFile(null);
    setBackFile(null);
    setSubmitPhase("redirecting");
    setUploadProgress(100);
    setFormKey((value) => value + 1);
    window.location.assign(`/customers/${encodeURIComponent(customerId)}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setFileError(null);

    if (!nameReady) {
      setFormMessage("请填写客户姓名。 ");
      return;
    }
    if (!phoneReady) {
      setFormMessage("请输入有效手机号，可包含国家或地区区号。 ");
      return;
    }
    if (duplicateCustomer) {
      setFormMessage("该手机号已经录入，请打开现有客户或从回收站恢复。 ");
      return;
    }
    if (bankCardNumber && !isValidBankCardNumber(bankCardNumber)) {
      setFormMessage("银行卡号需为 12～19 位数字。 ");
      return;
    }
    if (!machineReady) {
      setFormMessage("选择机器后，请同时选择购买或赠送，并填写 0～100 之间的费率。 ");
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setFormMessage(null);
    setSubmitPhase("verifying");

    try {
      const unlocked = await unlockLocalVaultSession(
        password,
        controller.signal,
      );
      if (controller.signal.aborted) return;

      setSubmitPhase("saving");
      const savedCustomer = await saveLocalCustomer(
        {
          name: name.trim(),
          shopName: shopName.trim() || null,
          phone: normalizedPhone,
          category,
          machineType: machineType || null,
          machineMode: machineMode || null,
          feeRate: parsedFeeRate,
          idCardFront: frontFile,
          idCardBack: backFile,
          bankCardNumber: bankCardNumber
            ? bankCardDigits(bankCardNumber)
            : null,
          createdAt: new Date().toISOString(),
        },
        unlocked.session,
      );
      if (controller.signal.aborted) return;

      finishSuccessfulSave(savedCustomer.id);
    } catch (saveError) {
      if (controller.signal.aborted) return;
      if (isCloudSaveFallback(saveError)) {
        clearRememberedLocalVaultSession();
        try {
          const cloudCustomerId = await uploadCloudCustomer({
            customerName: name.trim(),
            customerPhone: normalizedPhone,
            shopName: shopName.trim() || null,
            category,
            machineType: machineType || null,
            machineMode: machineMode || null,
            feeRate: parsedFeeRate,
            front: frontFile,
            back: backFile,
            cardNumber: bankCardNumber
              ? bankCardDigits(bankCardNumber)
              : null,
            verificationPassword: password,
            nextFollowUpAt: nextFollowUpAt
              ? new Date(nextFollowUpAt).toISOString()
              : null,
          });
          finishSuccessfulSave(cloudCustomerId);
        } catch (cloudSaveError) {
          setPassword("");
          setBankCardNumber("");
          setSubmitPhase("idle");
          setUploadProgress(0);
          setFormMessage(
            cloudSaveError instanceof Error
              ? cloudSaveError.message
              : "客户保存失败，请检查网络后重试。 ",
          );
        }
        return;
      }

      clearRememberedLocalVaultSession();
      setPassword("");
      setBankCardNumber("");
      setSubmitPhase("idle");
      setUploadProgress(0);
      setFormMessage(
        saveError instanceof Error
          ? saveError.message
          : "本机加密保存失败，请检查浏览器存储空间后重试。 ",
      );
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  function resetForm() {
    if (isSubmitting) return;
    setName("");
    setPhone("");
    setShopName("");
    setCategory("直营");
    setMachineType("");
    setMachineMode("");
    setFeeRate("");
    setNextFollowUpAt("");
    setDuplicateCustomer(null);
    setBankCardNumber("");
    setPassword("");
    setFrontFile(null);
    setBackFile(null);
    setFileError(null);
    setFormMessage(null);
    setUploadProgress(0);
    setFormKey((value) => value + 1);
  }

  return (
    <div className="min-h-screen bg-[#f3f6fb] pb-24 text-[#172033] sm:pb-10">
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
            新增客户
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Link
          href="/customers"
          className="mb-5 inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-medium text-[#5f6b7a] outline-none transition hover:text-[#2f6bff] focus-visible:ring-2 focus-visible:ring-[#2f6bff]"
        >
          <span aria-hidden="true">←</span>
          返回客户列表
        </Link>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="overflow-hidden rounded-xl border border-[#e7ecf5] bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
            <div className="border-b border-[#e7ecf5] bg-[#f8faff] px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2f6bff]">
                    Quick entry
                  </p>
                  <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em]">
                    新增客户
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-[#667085]">
                    姓名和手机号可先保存；证件未补齐时自动归为“资料待补”。
                  </p>
                </div>
                <span className="rounded-full bg-[#eaf1ff] px-3 py-1.5 text-xs font-semibold text-[#2859d9]">
                  {completedCount} / 4 已完成
                </span>
              </div>
            </div>

            <form
              key={formKey}
              id="new-customer-form"
              onSubmit={handleSubmit}
              aria-busy={isSubmitting}
              className="p-5 sm:p-6"
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <label
                  htmlFor="customer-name"
                  aria-label="客户姓名"
                  className="block"
                >
                  <span className="mb-2 flex items-center justify-between text-sm font-semibold text-[#344054]">
                    <span>姓名</span>
                    <span className="text-xs font-normal text-[#9a4f36]">必填</span>
                  </span>
                  <input
                    id="customer-name"
                    type="text"
                    autoComplete="name"
                    disabled={isSubmitting}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setFormMessage(null);
                    }}
                    placeholder="请输入客户姓名"
                    className="h-12 w-full rounded-xl border border-[#d9e2f0] bg-[#f8faff] px-4 text-base outline-none transition focus:border-[#2f6bff] focus:bg-white focus:ring-4 focus:ring-[#2f6bff]/10"
                  />
                </label>

                <label
                  htmlFor="customer-phone"
                  aria-label="客户手机号"
                  className="block"
                >
                  <span className="mb-2 flex items-center justify-between text-sm font-semibold text-[#344054]">
                    <span>手机号</span>
                    <span className="text-xs font-normal text-[#9a4f36]">必填</span>
                  </span>
                  <input
                    id="customer-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    disabled={isSubmitting}
                    value={phone}
                    onChange={(event) => {
                      const nextPhone = event.target.value;
                      const nextNormalized = nextPhone.replace(/[\s-]/g, "");
                      setPhone(nextPhone);
                      setDuplicateCustomer(null);
                      setIsCheckingPhone(/^\+?\d{7,20}$/.test(nextNormalized));
                      setFormMessage(null);
                    }}
                    placeholder="例如 13800138888"
                    className="h-12 w-full rounded-xl border border-[#d9e2f0] bg-[#f8faff] px-4 font-mono text-base outline-none transition focus:border-[#2f6bff] focus:bg-white focus:ring-4 focus:ring-[#2f6bff]/10"
                  />
                  {isCheckingPhone && (
                    <span className="mt-2 block text-xs text-[#7a8699]">
                      正在检查是否重复…
                    </span>
                  )}
                  {duplicateCustomer && (
                    <span className="mt-2 block rounded-lg bg-[#fff3ec] px-3 py-2 text-xs leading-5 text-[#99502f]">
                      已存在客户“{duplicateCustomer.name}”（
                      {duplicateCustomer.maskedPhone}）。
                      {duplicateCustomer.inTrash ? (
                        <Link
                          href="/customers/trash"
                          className="ml-1 font-semibold underline"
                        >
                          前往回收站恢复
                        </Link>
                      ) : (
                        <Link
                          href={`/customers/${duplicateCustomer.id}`}
                          className="ml-1 font-semibold underline"
                        >
                          打开现有客户
                        </Link>
                      )}
                    </span>
                  )}
                </label>

                <label
                  htmlFor="customer-shop-name"
                  aria-label="店铺名字"
                  className="block sm:col-span-2"
                >
                  <span className="mb-2 flex items-center justify-between text-sm font-semibold text-[#344054]">
                    <span>店铺名字</span>
                    <span className="text-xs font-normal text-[#7a8699]">选填</span>
                  </span>
                  <input
                    id="customer-shop-name"
                    type="text"
                    autoComplete="organization"
                    disabled={isSubmitting}
                    maxLength={120}
                    value={shopName}
                    onChange={(event) => {
                      setShopName(event.target.value);
                      setFormMessage(null);
                    }}
                    placeholder="请输入店铺名字，例如：广州第一螺"
                    className="h-12 w-full rounded-xl border border-[#d9e2f0] bg-[#f8faff] px-4 text-base outline-none transition focus:border-[#2f6bff] focus:bg-white focus:ring-4 focus:ring-[#2f6bff]/10"
                  />
                </label>

                <label
                  htmlFor="customer-category"
                  aria-label="客户分类"
                  className="block sm:col-span-2"
                >
                  <span className="mb-2 flex items-center justify-between text-sm font-semibold text-[#344054]">
                    <span>客户分类</span>
                    <span className="text-xs font-normal text-[#7a8699]">便于筛选和跟进</span>
                  </span>
                  <select
                    id="customer-category"
                    disabled={isSubmitting}
                    value={category}
                    onChange={(event) => {
                      setCategory(event.target.value as LocalCustomerCategory);
                      setFormMessage(null);
                    }}
                    className="h-12 w-full rounded-xl border border-[#d9e2f0] bg-[#f8faff] px-4 text-base outline-none transition focus:border-[#2f6bff] focus:bg-white focus:ring-4 focus:ring-[#2f6bff]/10"
                  >
                    {LOCAL_CUSTOMER_CATEGORIES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>

                <fieldset className="rounded-xl border border-[#d9e2f0] bg-[#f8faff] p-4 sm:col-span-2">
                  <legend className="px-1 text-sm font-semibold text-[#344054]">
                    机器与费率
                  </legend>
                  <p className="mb-4 mt-1 text-xs leading-5 text-[#7a8699]">
                    选填。选择机器后，购买方式和费率需要一起填写。
                  </p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label htmlFor="customer-machine-type" className="block">
                      <span className="mb-2 block text-sm font-medium text-[#475467]">机器</span>
                      <select
                        id="customer-machine-type"
                        disabled={isSubmitting}
                        value={machineType}
                        onChange={(event) => {
                          const value = event.target.value as "" | CustomerMachineType;
                          setMachineType(value);
                          if (!value) {
                            setMachineMode("");
                            setFeeRate("");
                          }
                          setFormMessage(null);
                        }}
                        className="h-12 w-full rounded-xl border border-[#d9e2f0] bg-white px-3 text-base outline-none transition focus:border-[#2f6bff] focus:ring-4 focus:ring-[#2f6bff]/10"
                      >
                        <option value="">暂不选择</option>
                        {CUSTOMER_MACHINE_TYPES.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </label>

                    <label htmlFor="customer-machine-mode" className="block">
                      <span className="mb-2 block text-sm font-medium text-[#475467]">机器模式</span>
                      <select
                        id="customer-machine-mode"
                        disabled={isSubmitting || !machineType}
                        value={machineMode}
                        onChange={(event) => {
                          setMachineMode(event.target.value as "" | CustomerMachineMode);
                          setFormMessage(null);
                        }}
                        className="h-12 w-full rounded-xl border border-[#d9e2f0] bg-white px-3 text-base outline-none transition disabled:bg-[#eef2f7] disabled:text-[#98a2b3] focus:border-[#2f6bff] focus:ring-4 focus:ring-[#2f6bff]/10"
                      >
                        <option value="">请选择</option>
                        {CUSTOMER_MACHINE_MODES.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </label>

                    <label htmlFor="customer-fee-rate" className="block">
                      <span className="mb-2 block text-sm font-medium text-[#475467]">费率</span>
                      <div className="relative">
                        <input
                          id="customer-fee-rate"
                          type="number"
                          inputMode="decimal"
                          min="0.01"
                          max="100"
                          step="0.01"
                          disabled={isSubmitting || !machineType}
                          value={feeRate}
                          onChange={(event) => {
                            setFeeRate(event.target.value);
                            setFormMessage(null);
                          }}
                          placeholder="例如 0.38"
                          className="h-12 w-full rounded-xl border border-[#d9e2f0] bg-white px-3 pr-9 text-base outline-none transition disabled:bg-[#eef2f7] disabled:text-[#98a2b3] focus:border-[#2f6bff] focus:ring-4 focus:ring-[#2f6bff]/10"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-[#667085]">%</span>
                      </div>
                    </label>
                  </div>
                  {!machineReady && (
                    <p className="mt-3 text-xs text-[#99502f]">请补齐机器模式和有效费率。</p>
                  )}
                </fieldset>

                <label
                  htmlFor="customer-follow-up"
                  aria-label="下次跟进时间"
                  className="block sm:col-span-2"
                >
                  <span className="mb-2 flex items-center justify-between text-sm font-semibold text-[#344054]">
                    <span>下次跟进时间</span>
                    <span className="text-xs font-normal text-[#7a8699]">
                      选填，到期在首页提醒
                    </span>
                  </span>
                  <input
                    id="customer-follow-up"
                    type="datetime-local"
                    disabled={isSubmitting}
                    value={nextFollowUpAt}
                    onChange={(event) => setNextFollowUpAt(event.target.value)}
                    className="h-12 w-full rounded-xl border border-[#d9e2f0] bg-[#f8faff] px-4 text-base outline-none transition focus:border-[#2f6bff] focus:bg-white focus:ring-4 focus:ring-[#2f6bff]/10"
                  />
                </label>

                <label
                  htmlFor="customer-bank-card"
                  aria-label="客户银行卡号"
                  className="block sm:col-span-2"
                >
                  <span className="mb-2 flex items-center justify-between text-sm font-semibold text-[#344054]">
                    <span>银行卡号</span>
                    <span className="text-xs font-normal text-[#7a8699]">选填</span>
                  </span>
                  <input
                    id="customer-bank-card"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={isSubmitting}
                    maxLength={23}
                    value={bankCardNumber}
                    onChange={(event) => {
                      setBankCardNumber(
                        formatBankCardNumber(event.target.value),
                      );
                      setFormMessage(null);
                    }}
                    placeholder="输入 12～19 位银行卡号"
                    aria-describedby="new-bank-card-guidance"
                    className="h-12 w-full rounded-xl border border-[#d9e2f0] bg-[#f8faff] px-4 font-mono text-base tracking-wide outline-none transition focus:border-[#2f6bff] focus:bg-white focus:ring-4 focus:ring-[#2f6bff]/10"
                  />
                  <span
                    id="new-bank-card-guidance"
                    className="mt-2 block text-xs leading-5 text-[#7a8699]"
                  >
                    仅填写银行卡号；绝不要填写 CVV、安全码、PIN 或银行卡密码。
                  </span>
                  {bankCardNumber &&
                    !isValidBankCardNumber(bankCardNumber) && (
                      <span className="mt-1 block text-xs text-[#99502f]">
                        请输入 12～19 位银行卡号。
                      </span>
                    )}
                </label>

              </div>

              <fieldset className="mt-7">
                <legend className="text-sm font-semibold text-[#344054]">
                  身份证资料
                </legend>
                <p className="mt-1 text-xs leading-5 text-[#7a8699]">
                  图片保存到当前账号的私有文件库，不生成公开链接，也不会发送到第三方普通搜索服务。
                </p>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <UploadField
                    id="id-card-front"
                    title="身份证正面"
                    hint="人像面，文字清晰、四角完整"
                    file={frontFile}
                    disabled={isSubmitting}
                    onChange={(event) => handleDocument(event, "front")}
                  />
                  <UploadField
                    id="id-card-back"
                    title="身份证反面"
                    hint="国徽面，避免反光与遮挡"
                    file={backFile}
                    disabled={isSubmitting}
                    onChange={(event) => handleDocument(event, "back")}
                  />
                </div>
              </fieldset>

              {fileError && (
                <p
                  role="alert"
                  className="mt-5 rounded-xl border border-[#ecd8ca] bg-[#fff8f3] px-4 py-3 text-sm text-[#864b32]"
                >
                  {fileError}
                </p>
              )}

              {formMessage && (
                <p
                  role="alert"
                  className="mt-5 rounded-xl border border-[#ecd8ca] bg-[#fff8f3] px-4 py-3 text-sm leading-6 text-[#864b32]"
                >
                  {formMessage}
                </p>
              )}

              {isSubmitting && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mt-5 rounded-xl border border-[#cbdcff] bg-[#f5f8ff] px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-[#2859d9]">
                      {submitPhase === "verifying"
                        ? "正在确认安全保存位置"
                        : submitPhase === "uploading"
                          ? "正在上传证件资料"
                        : submitPhase === "saving"
                          ? "正在保存客户档案"
                          : "保存成功，正在打开详情"}
                    </span>
                    <span className="font-mono text-xs text-[#667085]">
                      {saveProgress}%
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#dfe8fb]">
                    <div
                      className={`h-full rounded-full bg-[#2f6bff] transition-[width] duration-200 ${
                        submitPhase === "saving" ||
                        submitPhase === "uploading"
                          ? "animate-pulse"
                          : ""
                      }`}
                      style={{
                        width: `${saveProgress}%`,
                      }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-[#667085]">
                    请保持页面开启，不要重复提交或离开当前页面。
                  </p>
                </div>
              )}

              <div className="mt-7 hidden items-center justify-between gap-4 border-t border-[#edf1f7] pt-6 sm:flex">
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={isSubmitting}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold text-[#667085] transition hover:bg-[#f7f9fc] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  清空内容
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit || isSubmitting}
                  className="rounded-xl bg-[#2f6bff] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_10px_rgba(47,107,255,0.18)] transition hover:bg-[#245ae8] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting
                    ? "正在保存…"
                    : isComplete
                      ? "保存完整客户"
                      : "保存为资料待补"}
                </button>
              </div>
            </form>
          </section>

          <aside className="space-y-4 lg:sticky lg:top-6">
            <div
              className={`rounded-xl border p-5 ${
                isComplete
                  ? "border-[#cbdcff] bg-[#eef4ff]"
                  : "border-[#eadcc7] bg-[#fff8eb]"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#7a8699]">
                资料状态
              </p>
              <div className="mt-3 flex items-center gap-3">
                <span
                  className={`grid size-10 place-items-center rounded-xl text-lg font-bold ${
                    isComplete
                      ? "bg-[#e0eaff] text-[#2859d9]"
                      : "bg-[#ffedd2] text-[#94591f]"
                  }`}
                  aria-hidden="true"
                >
                  {isComplete ? "✓" : "!"}
                </span>
                <div>
                  <h2 className="font-semibold">
                    {isComplete ? "资料完整" : "资料待补"}
                  </h2>
                  <p className="mt-0.5 text-xs text-[#667085]">
                    姓名、手机号和证件正反面齐全后自动更新
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[#e7ecf5] bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold">手机电脑自动同步</h2>
              <p className="mt-2 text-xs leading-5 text-[#667085]">
                使用同一个登录账号时，手机录入后电脑端可立即搜索和继续补充；完整资料仅本人账号可查看。
              </p>
            </div>
          </aside>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-[#e7ecf5] bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] backdrop-blur sm:hidden">
        <button
          type="button"
          onClick={resetForm}
          disabled={isSubmitting}
          className="h-12 flex-1 rounded-xl border border-[#d9e2f0] text-sm font-semibold text-[#667085] disabled:cursor-not-allowed disabled:opacity-50"
        >
          清空
        </button>
        <button
          type="submit"
          form="new-customer-form"
          disabled={!canSubmit || isSubmitting}
          className="h-12 flex-[1.7] rounded-xl bg-[#2f6bff] text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting
            ? "正在保存…"
            : isComplete
              ? "保存完整客户"
              : "保存为资料待补"}
        </button>
      </div>
    </div>
  );
}

function UploadField({
  id,
  title,
  hint,
  file,
  disabled,
  onChange,
}: {
  id: string;
  title: string;
  hint: string;
  file: File | null;
  disabled: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label
      htmlFor={id}
      aria-label={`上传${title}`}
      className={`group flex min-h-40 flex-col justify-between rounded-xl border border-dashed p-4 outline-none transition focus-within:ring-4 focus-within:ring-[#2f6bff]/10 ${
        disabled
          ? "cursor-wait opacity-60"
          : "cursor-pointer hover:border-[#7fa4ff] hover:bg-[#f5f8ff]"
      } ${
        file
          ? "border-[#8eafff] bg-[#f5f8ff]"
          : "border-[#d9e2f0] bg-[#f8faff]"
      }`}
    >
      <input
        id={id}
        type="file"
        accept="image/*"
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-white text-xl text-[#2f6bff] shadow-sm ring-1 ring-[#dfe6de]">
          {file ? "✓" : "+"}
        </span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#5f6b7a] shadow-sm">
          {file ? "重新选择" : "拍照 / 相册"}
        </span>
      </div>
      <div className="mt-4">
        <p className="text-sm font-semibold text-[#344054]">{title}</p>
        <p className="mt-1 truncate text-xs text-[#7a8699]">
          {file ? file.name : hint}
        </p>
      </div>
    </label>
  );
}
