import type {
  ApiErrorResponse,
  CustomerCreateResponse,
} from "@/lib/search/types";
import {
  isCustomerMachineMode,
  isCustomerMachineType,
  isValidCustomerFeeRate,
} from "@/lib/customers/machine";
import {
  normalizeCustomerAddress,
  normalizeCustomerTags,
  normalizeMachineDeposit,
} from "@/lib/customers/profile";
import {
  BankCardConfigurationError,
  encryptBankCardNumber,
  InvalidBankCardError,
  normalizeAndValidateCardNumber,
} from "@/lib/security/bank-card";
import {
  authorizeSensitiveRequest,
  SensitiveAccessConfigurationError,
} from "@/lib/security/sensitive-access";
import {
  deleteCustomerIdentityImage,
  uploadCustomerIdentityImage,
} from "@/lib/supabase/customer-storage";
import {
  BackendConfigurationError,
  callSupabaseRpc,
  getEndUserBearerToken,
  getSearchBackendConfig,
  SupabaseRestError,
  verifySupabaseUserSession,
} from "@/lib/supabase/rest";
import {
  callSensitiveServiceRpc,
  getSensitiveServiceConfig,
  SensitiveServiceConfigurationError,
} from "@/lib/supabase/sensitive-service";
import {
  getIdCardBucket,
  StorageConfigurationError,
} from "@/lib/supabase/storage";
import {
  activityStatement,
  apiError as workspaceApiError,
  customerBusinessLicenseObjectKey,
  customerObjectKey,
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
  normalizeCustomerCategory,
  privateJson,
  workspaceUserId,
} from "@/lib/workspace/server";

const MAX_MULTIPART_BYTES = 33 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const ALLOWED_FIELDS = new Set([
  "name",
  "phone",
  "shopName",
  "idCardFront",
  "idCardBack",
  "bankCardNumber",
  "password",
  "category",
  "nextFollowUpAt",
  "machineType",
  "machineMode",
  "feeRate",
  "depositAmount",
  "address",
  "tags",
  "businessLicense",
]);

interface CreateCustomerRpcRow {
  id: string;
}

interface UpdateBankCardRpcRow {
  last4: string;
}

export async function POST(request: Request): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_MULTIPART_BYTES
  ) {
    return errorResponse(413, "CUSTOMER_UPLOAD_TOO_LARGE", "上传图片总大小超出限制");
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return errorResponse(415, "CUSTOMER_FORM_REQUIRED", "请使用客户录入表单提交");
  }

  if (await isWorkspaceCloudConfigured()) {
    return createWorkspaceCustomer(request);
  }

  let backend;
  try {
    backend = getSearchBackendConfig();
  } catch (error) {
    return errorResponse(
      503,
      "CUSTOMER_SERVICE_NOT_CONFIGURED",
      error instanceof BackendConfigurationError ? error.message : "客户服务配置无效",
    );
  }
  if (backend.mode === "demo") {
    // Never accept real identity images or PANs into an ephemeral demo worker.
    // The production form becomes writable only after Supabase is configured.
    return errorResponse(
      503,
      "CUSTOMER_CREATE_DEMO_DISABLED",
      "演示环境不会接收真实客户资料，请先连接 Supabase",
    );
  }

  const userAccessToken = getEndUserBearerToken(request, backend.anonKey);
  if (!userAccessToken) {
    return errorResponse(401, "AUTH_REQUIRED", "请先登录后再录入客户");
  }
  let userId: string;
  try {
    userId = await verifySupabaseUserSession(backend, userAccessToken);
  } catch (error) {
    if (error instanceof SupabaseRestError && error.status === 504) {
      return errorResponse(504, "AUTH_VERIFY_TIMEOUT", "登录验证超时，请稍后重试");
    }
    return errorResponse(401, "AUTH_REQUIRED", "登录状态无效，请重新登录");
  }

  let form: FormData;
  try {
    form = (await request.formData()) as unknown as FormData;
  } catch {
    return errorResponse(400, "INVALID_CUSTOMER_FORM", "客户录入表单无效");
  }
  if (Array.from(form.keys()).some((key) => !ALLOWED_FIELDS.has(key))) {
    return errorResponse(400, "INVALID_CUSTOMER_FORM", "客户录入表单包含未知字段");
  }

  const name = readText(form, "name").trim();
  const phone = normalizePhone(readText(form, "phone"));
  const shopName = readText(form, "shopName").trim();
  const front = form.get("idCardFront");
  const back = form.get("idCardBack");
  const bankCardInput = readText(form, "bankCardNumber").trim();
  const password = readText(form, "password");

  if (!name || name.length > 100) {
    return errorResponse(400, "INVALID_CUSTOMER_NAME", "请输入 1～100 个字符的姓名");
  }
  if (!/^\+?[0-9]{6,20}$/.test(phone)) {
    return errorResponse(400, "INVALID_CUSTOMER_PHONE", "请输入有效手机号");
  }
  if (shopName.length > 120) {
    return errorResponse(400, "INVALID_SHOP_NAME", "店铺名字不能超过 120 个字符");
  }
  if (!isAcceptedImage(front) || !isAcceptedImage(back)) {
    return errorResponse(
      400,
      "INVALID_ID_CARD_IMAGES",
      "请上传 10MB 以内的 JPG、PNG 或 WebP 身份证正反面图片",
    );
  }

  let bankCardNumber: string | null = null;
  if (bankCardInput) {
    try {
      bankCardNumber = normalizeAndValidateCardNumber(bankCardInput);
    } catch {
      return errorResponse(400, "INVALID_BANK_CARD_NUMBER", "银行卡号格式或校验失败");
    }
  }

  const customerId = crypto.randomUUID();
  let encryptedBankCard:
    | { ciphertext: string; last4: string }
    | null = null;
  if (bankCardNumber) {
    try {
      const authorization = await authorizeSensitiveRequest(
        request,
        backend,
        password,
      );
      if (!authorization.authorized) return sensitiveDeniedResponse();
      encryptedBankCard = await encryptBankCardNumber(bankCardNumber, customerId);
      getSensitiveServiceConfig(backend);
    } catch (error) {
      if (
        error instanceof SensitiveAccessConfigurationError ||
        error instanceof BankCardConfigurationError ||
        error instanceof SensitiveServiceConfigurationError
      ) {
        return errorResponse(503, "SENSITIVE_SERVICE_NOT_CONFIGURED", error.message);
      }
      return errorResponse(503, "SENSITIVE_SERVICE_UNAVAILABLE", "敏感资料服务暂时不可用");
    }
  }

  let bucket: string;
  try {
    bucket = getIdCardBucket();
  } catch (error) {
    return errorResponse(
      503,
      "ID_CARD_STORAGE_NOT_CONFIGURED",
      error instanceof StorageConfigurationError ? error.message : "身份证存储服务配置无效",
    );
  }

  const frontPath = `${userId}/${customerId}/front`;
  const backPath = `${userId}/${customerId}/back`;
  const uploadedPaths: string[] = [];
  try {
    await uploadCustomerIdentityImage(
      backend,
      userAccessToken,
      bucket,
      frontPath,
      front,
    );
    uploadedPaths.push(frontPath);
    await uploadCustomerIdentityImage(
      backend,
      userAccessToken,
      bucket,
      backPath,
      back,
    );
    uploadedPaths.push(backPath);

    const rows = await callSupabaseRpc<CreateCustomerRpcRow[]>(
      backend,
      userAccessToken,
      "create_sales_workspace_customer",
      {
        p_customer_id: customerId,
        p_name: name,
        p_phone: phone,
        p_id_card_front_path: frontPath,
        p_id_card_back_path: backPath,
      },
    );
    if (!Array.isArray(rows) || rows[0]?.id !== customerId) {
      throw new SupabaseRestError(502);
    }
  } catch (error) {
    await cleanupUploads(backend, userAccessToken, bucket, uploadedPaths);
    return mapCreateError(error);
  }

  let warning: string | undefined;
  if (encryptedBankCard) {
    try {
      const service = getSensitiveServiceConfig(backend);
      const rows = await callSensitiveServiceRpc<UpdateBankCardRpcRow[]>(
        service,
        "update_sales_workspace_customer_bank_card",
        {
          p_customer_id: customerId,
          p_bank_card_ciphertext: encryptedBankCard.ciphertext,
          p_bank_card_last4: encryptedBankCard.last4,
        },
      );
      if (!Array.isArray(rows) || rows[0]?.last4 !== encryptedBankCard.last4) {
        throw new SupabaseRestError(502);
      }
    } catch {
      // The customer and identity images were already stored successfully.
      // Return the new ID so the user can retry the card inside the protected
      // detail screen without creating a duplicate customer.
      warning = "客户已保存，但银行卡号保存失败，请在客户详情中重试";
    }
  }

  return jsonResponse<CustomerCreateResponse>(
    { id: customerId, ...(warning ? { warning } : {}) },
    201,
  );
}

async function createWorkspaceCustomer(request: Request): Promise<Response> {
  const userId = await workspaceUserId(request);
  if (!userId) return workspaceApiError(401, "AUTH_REQUIRED", "请先登录后再录入客户");

  let form: FormData;
  try {
    form = (await request.formData()) as unknown as FormData;
  } catch {
    return workspaceApiError(400, "INVALID_CUSTOMER_FORM", "客户录入表单无效");
  }
  if (Array.from(form.keys()).some((key) => !ALLOWED_FIELDS.has(key))) {
    return workspaceApiError(400, "INVALID_CUSTOMER_FORM", "客户录入表单包含未知字段");
  }

  const name = readText(form, "name").trim();
  const phone = normalizePhone(readText(form, "phone"));
  const shopName = readText(form, "shopName").trim();
  const category = normalizeCustomerCategory(readText(form, "category"));
  const machineTypeInput = readText(form, "machineType");
  const machineModeInput = readText(form, "machineMode");
  const feeRateInput = readText(form, "feeRate");
  const machineType = machineTypeInput || null;
  const machineMode = machineModeInput || null;
  const feeRate = feeRateInput ? Number(feeRateInput) : null;
  const depositInput = readText(form, "depositAmount");
  let depositAmount: number | null;
  let address: string | null;
  let tags: string[];
  try {
    depositAmount = normalizeMachineDeposit(depositInput);
    address = normalizeCustomerAddress(readText(form, "address"));
    const tagsInput = readText(form, "tags");
    tags = normalizeCustomerTags(tagsInput ? JSON.parse(tagsInput) : []);
  } catch {
    return workspaceApiError(400, "INVALID_CUSTOMER_PROFILE", "押金、地址或客户标签格式无效");
  }
  const nextFollowUpAtInput = readText(form, "nextFollowUpAt");
  const nextFollowUpAt = nextFollowUpAtInput
    ? new Date(nextFollowUpAtInput)
    : null;
  const frontValue = form.get("idCardFront");
  const backValue = form.get("idCardBack");
  const front = frontValue instanceof File && frontValue.size > 0 ? frontValue : null;
  const back = backValue instanceof File && backValue.size > 0 ? backValue : null;
  const licenseValue = form.get("businessLicense");
  const businessLicense = licenseValue instanceof File && licenseValue.size > 0
    ? licenseValue
    : null;
  if (!name || name.length > 100) {
    return workspaceApiError(400, "INVALID_CUSTOMER_NAME", "请输入 1～100 个字符的姓名");
  }
  if (!/^\+?[0-9]{6,20}$/.test(phone)) {
    return workspaceApiError(400, "INVALID_CUSTOMER_PHONE", "请输入有效手机号");
  }
  if (shopName.length > 120) {
    return workspaceApiError(400, "INVALID_SHOP_NAME", "店铺名字不能超过 120 个字符");
  }
  if (nextFollowUpAt && Number.isNaN(nextFollowUpAt.getTime())) {
    return workspaceApiError(400, "INVALID_FOLLOW_UP_AT", "下次跟进时间无效");
  }
  if (
    (machineType !== null && !isCustomerMachineType(machineType)) ||
    (machineType === null && (machineMode !== null || feeRate !== null)) ||
    (machineType !== null && (!isCustomerMachineMode(machineMode) || !isValidCustomerFeeRate(feeRate)))
  ) {
    return workspaceApiError(400, "INVALID_MACHINE_DETAILS", "请选择机器、购买方式并填写 0～100 之间的费率");
  }
  if (machineType === null && depositAmount !== null) {
    return workspaceApiError(400, "INVALID_MACHINE_DEPOSIT", "选择机器后才能填写押金");
  }
  if (
    (front && !isAcceptedImage(front)) ||
    (back && !isAcceptedImage(back)) ||
    (businessLicense && !isAcceptedImage(businessLicense))
  ) {
    return workspaceApiError(400, "INVALID_ID_CARD_IMAGES", "请上传 10MB 以内的 JPG、PNG 或 WebP 图片");
  }

  const bankCardInput = readText(form, "bankCardNumber").trim();
  let encryptedBankCard: { ciphertext: string; last4: string } | null = null;
  const customerId = crypto.randomUUID();
  if (bankCardInput) {
    try {
      const cardNumber = normalizeAndValidateCardNumber(bankCardInput);
      encryptedBankCard = await encryptBankCardNumber(cardNumber, customerId);
    } catch (error) {
      if (error instanceof InvalidBankCardError) {
        return workspaceApiError(400, "INVALID_BANK_CARD_NUMBER", "银行卡号应为 12～19 位数字");
      }
      return workspaceApiError(503, "SENSITIVE_SERVICE_UNAVAILABLE", "银行卡加密服务暂时不可用");
    }
  }

  const { db, files } = await getWorkspaceBindings();
  const existing = await db
    .prepare("SELECT id FROM customers WHERE owner_id = ?1 AND phone = ?2 LIMIT 1")
    .bind(userId, phone)
    .first<{ id: string }>();
  if (existing) {
    const duplicate = await db
      .prepare("SELECT deleted_at FROM customers WHERE id = ?1 AND owner_id = ?2 LIMIT 1")
      .bind(existing.id, userId)
      .first<{ deleted_at: string | null }>();
    return workspaceApiError(
      409,
      "CUSTOMER_ALREADY_EXISTS",
      duplicate?.deleted_at
        ? "该手机号对应的客户在回收站中，请先恢复客户"
        : "该手机号已经录入，请直接搜索客户",
    );
  }

  const frontKey = front ? customerObjectKey(userId, customerId, "front") : null;
  const backKey = back ? customerObjectKey(userId, customerId, "back") : null;
  const businessLicenseKey = businessLicense
    ? customerBusinessLicenseObjectKey(userId, customerId)
    : null;
  const uploadedKeys: string[] = [];
  try {
    if (front && frontKey) {
      await files.put(frontKey, front.stream(), {
        httpMetadata: { contentType: front.type },
        customMetadata: { ownerId: userId, customerId, side: "front" },
      });
      uploadedKeys.push(frontKey);
    }
    if (back && backKey) {
      await files.put(backKey, back.stream(), {
        httpMetadata: { contentType: back.type },
        customMetadata: { ownerId: userId, customerId, side: "back" },
      });
      uploadedKeys.push(backKey);
    }
    if (businessLicense && businessLicenseKey) {
      await files.put(businessLicenseKey, businessLicense.stream(), {
        httpMetadata: { contentType: businessLicense.type },
        customMetadata: { ownerId: userId, customerId, kind: "business-license" },
      });
      uploadedKeys.push(businessLicenseKey);
    }
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(
        `INSERT INTO customers (
          id, owner_id, name, phone, shop_name, category,
          machine_type, machine_mode, fee_rate,
          deposit_amount, address, tags_json,
          id_card_front_key, id_card_back_key, business_license_key,
          bank_card_ciphertext, bank_card_last4,
          next_follow_up_at, deleted_at, purge_after,
          created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, NULL, NULL, ?19, ?20)`,
      )
      .bind(
        customerId,
        userId,
        name,
        phone,
        shopName || null,
        category,
        machineType,
        machineMode,
        feeRate,
        depositAmount,
        address,
        JSON.stringify(tags),
        frontKey,
        backKey,
        businessLicenseKey,
        encryptedBankCard?.ciphertext ?? null,
        encryptedBankCard?.last4 ?? null,
        nextFollowUpAt?.toISOString() ?? null,
        now,
        now,
      ),
      activityStatement(db, {
        ownerId: userId,
        customerId,
        customerName: name,
        eventType: "customer_created",
        summary: "新增客户资料",
        createdAt: now,
      }),
    ]);
  } catch {
    await Promise.allSettled(uploadedKeys.map((key) => files.delete(key)));
    return workspaceApiError(502, "CUSTOMER_CREATE_UNAVAILABLE", "客户保存失败，请稍后重试");
  }

  return privateJson<CustomerCreateResponse>({ id: customerId }, 201);
}

function readText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const leadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return `${leadingPlus ? "+" : ""}${digits}`;
}

function isAcceptedImage(value: FormDataEntryValue | null): value is File {
  return (
    value instanceof File &&
    value.size > 0 &&
    value.size <= MAX_IMAGE_BYTES &&
    ALLOWED_IMAGE_TYPES.has(value.type.toLowerCase())
  );
}

async function cleanupUploads(
  backend: Extract<ReturnType<typeof getSearchBackendConfig>, { mode: "supabase" }>,
  token: string,
  bucket: string,
  paths: string[],
): Promise<void> {
  await Promise.allSettled(
    paths.map((path) =>
      deleteCustomerIdentityImage(backend, token, bucket, path),
    ),
  );
}

function mapCreateError(error: unknown): Response {
  if (error instanceof SupabaseRestError) {
    if (error.status === 401) {
      return errorResponse(401, "AUTH_EXPIRED", "登录已过期，请重新登录");
    }
    if (error.status === 403) {
      return errorResponse(403, "CUSTOMER_CREATE_FORBIDDEN", "当前账号无权录入客户");
    }
    if (error.status === 404) {
      return errorResponse(503, "CUSTOMER_CREATE_NOT_DEPLOYED", "客户录入服务尚未部署");
    }
    if (error.status === 409) {
      return errorResponse(409, "CUSTOMER_ALREADY_EXISTS", "该客户可能已存在，请先搜索确认");
    }
    if (error.status === 504) {
      return errorResponse(504, "CUSTOMER_CREATE_TIMEOUT", "客户录入超时，请稍后确认是否已保存");
    }
  }
  return errorResponse(502, "CUSTOMER_CREATE_UNAVAILABLE", "客户录入服务暂时不可用");
}

function sensitiveDeniedResponse(): Response {
  return errorResponse(401, "SENSITIVE_ACCESS_DENIED", "敏感资料验证失败");
}

function jsonResponse<T>(body: T, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      Vary: "Authorization",
    },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse<ApiErrorResponse>({ error: { code, message } }, status);
}
