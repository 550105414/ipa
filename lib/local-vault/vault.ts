import {
  LOCAL_VAULT_SCHEMA_VERSION,
  PBKDF2_ITERATIONS,
  aadFor,
  bytesToBase64Url,
  decryptBytes,
  decryptText,
  derivePhoneIndexKey,
  deriveSummaryAuthKey,
  deriveWrappingKey,
  encryptBytes,
  encryptText,
  hmacToken,
  importMasterKey,
  phoneFragments,
  randomBytes,
  randomId,
  scopeDigest,
  toArrayBuffer,
  webCrypto,
} from "./crypto";
import {
  LocalVaultAuthenticationError,
  LocalVaultConflictError,
  LocalVaultIntegrityError,
  LocalVaultNotFoundError,
  LocalVaultUnavailableError,
  LocalVaultValidationError,
} from "./errors";
import { registerObjectUrls, requireSessionSecret } from "./session";
import {
  isCustomerMachineMode,
  isCustomerMachineType,
  isValidCustomerFeeRate,
  type CustomerMachineMode,
  type CustomerMachineType,
} from "@/lib/customers/machine";
import type {
  LocalVaultStorage,
  StoredCustomerRecord,
  StoredVaultMetadata,
} from "./storage";
import type {
  LocalCustomerAccess,
  LocalCustomerCategory,
  LocalCustomerSearchPage,
  LocalCustomerSearchFilters,
  LocalCustomerSummary,
  LocalVaultScope,
  LocalVaultPageScope,
  LocalVaultSession,
  SaveLocalCustomerInput,
} from "./types";

const MAX_BLOB_BYTES = 20 * 1024 * 1024;

export type LocalVaultApi = {
  saveLocalCustomer(input: SaveLocalCustomerInput, session: LocalVaultSession): Promise<LocalCustomerSummary>;
  searchLocalCustomers(
    query: string,
    filters: LocalCustomerSearchFilters,
    scope: LocalVaultScope,
  ): Promise<LocalCustomerSummary[]>;
  searchLocalCustomersPage(
    query: string,
    filters: LocalCustomerSearchFilters,
    scope: LocalVaultPageScope,
  ): Promise<LocalCustomerSearchPage>;
  getLocalCustomer(id: string, scope: LocalVaultScope): Promise<LocalCustomerSummary | null>;
  unlockLocalCustomer(id: string, session: LocalVaultSession): Promise<LocalCustomerAccess>;
  updateLocalBankCard(
    id: string,
    session: LocalVaultSession,
    cardNumber: string,
  ): Promise<{ last4: string }>;
  getLocalPhone(id: string, session: LocalVaultSession): Promise<string>;
  updateLocalCustomerCategory(
    id: string,
    session: LocalVaultSession,
    category: LocalCustomerCategory,
  ): Promise<{ category: LocalCustomerCategory }>;
  clearLocalVault(session: LocalVaultSession): Promise<void>;
};

export function createLocalVaultApi(storage: LocalVaultStorage): LocalVaultApi {
  return {
    async saveLocalCustomer(input, session) {
      const sessionSecret = requireSessionSecret(session);
      const scopeKey = await scopeDigest(sessionSecret.userScope);
      const normalized = await normalizeInput(input);
      try {
        const id = input.id ? validateRecordId(input.id) : randomId();
        const storageKey = customerStorageKey(scopeKey, id);
        let metadata = await storage.getVault(scopeKey);

        if (!metadata) {
          const created = await createVaultMetadata(
            scopeKey,
            sessionSecret.password,
            sessionSecret.unlockSecret,
          );
          try {
            const record = await encryptCustomer(
              created.metadata,
              created.masterKey,
              normalized,
              id,
              storageKey,
            );
            await storage.commitNewVaultAndCustomer(created.metadata, record);
            return summaryFromRecord(record);
          } catch (error) {
            if (!(error instanceof LocalVaultConflictError)) throw error;
            metadata = await storage.getVault(scopeKey);
            if (!metadata) throw error;
          } finally {
            created.rawMasterKey.fill(0);
          }
        }

        const masterKey = await unlockMasterKey(metadata, sessionSecret.password, sessionSecret.unlockSecret);
        const record = await encryptCustomer(metadata, masterKey, normalized, id, storageKey);
        await storage.addCustomer(record);
        return summaryFromRecord(record);
      } finally {
        normalized.idCardFront?.fill(0);
        normalized.idCardBack?.fill(0);
      }
    },

    async searchLocalCustomers(query, filters, scope) {
      return (await searchPage(storage, query, filters, scope)).items;
    },

    async searchLocalCustomersPage(query, filters, scope) {
      return searchPage(storage, query, filters, scope);
    },

    async getLocalCustomer(id, scope) {
      const validId = validateRecordId(id);
      const scopeKey = await scopeDigest(scope.userScope);
      const record = await storage.getCustomerSummary(customerStorageKey(scopeKey, validId));
      if (!record) return null;
      const metadata = await storage.getVault(scopeKey);
      if (!metadata) throw new LocalVaultIntegrityError();
      await authenticateRecord(metadata, record);
      return summaryFromRecord(record);
    },

    async unlockLocalCustomer(id, session) {
      const context = await sensitiveContext(storage, id, session);
      const [phone, bankCardNumber, frontBytes, backBytes] = await Promise.all([
        decryptText(context.masterKey, context.record.encrypted.phone, fieldAad(context, "phone")),
        context.record.encrypted.bankCard
          ? decryptText(context.masterKey, context.record.encrypted.bankCard, fieldAad(context, "bank-card-pan"))
          : Promise.resolve(null),
        context.record.encrypted.idCardFront && context.record.idCardFrontType
          ? decryptBytes(
              context.masterKey,
              context.record.encrypted.idCardFront,
              blobFieldAad(context, "id-card-front", context.record.idCardFrontType),
            )
          : Promise.resolve(null),
        context.record.encrypted.idCardBack && context.record.idCardBackType
          ? decryptBytes(
              context.masterKey,
              context.record.encrypted.idCardBack,
              blobFieldAad(context, "id-card-back", context.record.idCardBackType),
            )
          : Promise.resolve(null),
      ]);
      validateDecryptedPhone(phone);
      if (bankCardNumber !== null && !isValidBankCard(bankCardNumber)) {
        frontBytes?.fill(0);
        backBytes?.fill(0);
        throw new LocalVaultIntegrityError();
      }
      const frontBlob = frontBytes && context.record.idCardFrontType
        ? new Blob([toArrayBuffer(frontBytes)], { type: context.record.idCardFrontType })
        : null;
      const backBlob = backBytes && context.record.idCardBackType
        ? new Blob([toArrayBuffer(backBytes)], { type: context.record.idCardBackType })
        : null;
      frontBytes?.fill(0);
      backBytes?.fill(0);
      if (typeof URL.createObjectURL !== "function") throw new LocalVaultUnavailableError();
      const urls: string[] = [];
      try {
        const frontUrl = frontBlob ? URL.createObjectURL(frontBlob) : null;
        if (frontUrl) urls.push(frontUrl);
        const backUrl = backBlob ? URL.createObjectURL(backBlob) : null;
        if (backUrl) urls.push(backUrl);
        const revoke = registerObjectUrls(session, urls);
        return {
          ...summaryFromRecord(context.record),
          phone,
          bankCardNumber,
          idCard: {
            frontUploaded: Boolean(frontBlob),
            backUploaded: Boolean(backBlob),
            frontBlob,
            backBlob,
            frontUrl,
            backUrl,
          },
          revoke,
        };
      } catch (error) {
        for (const url of urls) URL.revokeObjectURL(url);
        throw error;
      }
    },

    async updateLocalBankCard(id, session, cardNumber) {
      const normalizedCard = normalizeBankCard(cardNumber);
      const context = await sensitiveContext(storage, id, session);
      const encrypted = await encryptText(
        context.masterKey,
        normalizedCard,
        fieldAad(context, "bank-card-pan"),
      );
      const updatedRecord: StoredCustomerRecord = {
        ...context.record,
        hasBankCard: true,
        encrypted: { ...context.record.encrypted, bankCard: encrypted },
      };
      updatedRecord.summaryAuthTag = await summaryAuthTag(context.metadata, updatedRecord);
      await storage.putCustomer(updatedRecord);
      return { last4: normalizedCard.slice(-4) };
    },

    async getLocalPhone(id, session) {
      const context = await sensitiveContext(storage, id, session);
      const phone = await decryptText(
        context.masterKey,
        context.record.encrypted.phone,
        fieldAad(context, "phone"),
      );
      validateDecryptedPhone(phone);
      return phone;
    },
    async updateLocalCustomerCategory(id, session, category) {
      const context = await sensitiveContext(storage, id, session);
      context.record.category = normalizeCategory(category);
      context.record.summaryAuthTag = await summaryAuthTag(
        context.metadata,
        context.record,
      );
      await storage.putCustomer(context.record);
      return { category: context.record.category };
    },
    async clearLocalVault(session) {
      const secret = requireSessionSecret(session);
      const scopeKey = await scopeDigest(secret.userScope);
      const metadata = await storage.getVault(scopeKey);
      if (!metadata) return;
      await unlockMasterKey(metadata, secret.password, secret.unlockSecret);
      await storage.clearScope(scopeKey);
    },
  };
}

async function searchPage(
  storage: LocalVaultStorage,
  query: string,
  filters: LocalCustomerSearchFilters,
  scope: LocalVaultPageScope,
): Promise<LocalCustomerSearchPage> {
      const scopeKey = await scopeDigest(scope.userScope);
      const metadata = await storage.getVault(scopeKey);
      if (!metadata) {
        if (scope.cursor) throw new LocalVaultValidationError("分页游标无效。");
        return { items: [], nextCursor: null, total: 0 };
      }
      validateVaultMetadata(metadata, scopeKey);
      const normalizedFilters = normalizeFilters(filters);
      const trimmedQuery = query.trim();
      const numericQuery = normalizePhoneQuery(trimmedQuery);
      const phoneToken = numericQuery
        ? scopedPhoneToken(scopeKey, await hmacToken(metadata.phoneIndexKey, numericQuery))
        : null;
      const records = await storage.listCustomers(scopeKey, phoneToken ?? undefined);
      await Promise.all(records.map((record) => authenticateRecord(metadata, record)));
      const matching = records
        .filter(
          (record) =>
            (!trimmedQuery ||
              (phoneToken
                ? record.phoneTokens.includes(phoneToken)
                : record.name.toLocaleLowerCase().includes(trimmedQuery.toLocaleLowerCase()) ||
                  (record.shopName ?? "").toLocaleLowerCase().includes(trimmedQuery.toLocaleLowerCase()))) &&
            matchesStatus(record, normalizedFilters.status) &&
            matchesCategory(record, normalizedFilters.category) &&
            matchesPeriod(record.createdAt, normalizedFilters.period),
        )
        .sort(compareRecords);
      const criteriaTag = await searchCriteriaTag(
        metadata,
        trimmedQuery,
        normalizedFilters.status,
        normalizedFilters.period,
        normalizedFilters.category,
      );
      const anchor = scope.cursor
        ? await decodeSearchCursor(metadata, scope.cursor, criteriaTag)
        : null;
      const afterAnchor = anchor
        ? matching.filter((record) => compareRecordToAnchor(record, anchor) > 0)
        : matching;
      const pageRecords = afterAnchor.slice(0, normalizedFilters.limit);
      const nextCursor =
        afterAnchor.length > normalizedFilters.limit && pageRecords.length
          ? await encodeSearchCursor(
              metadata,
              criteriaTag,
              pageRecords[pageRecords.length - 1],
            )
          : null;
      return {
        items: pageRecords.map(summaryFromRecord),
        nextCursor,
        total: matching.length,
      };
}

type SearchCursorAnchor = { createdAt: string; id: string };

function compareRecords(left: StoredCustomerRecord, right: StoredCustomerRecord): number {
  return (
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  );
}

function compareRecordToAnchor(
  record: StoredCustomerRecord,
  anchor: SearchCursorAnchor,
): number {
  return (
    anchor.createdAt.localeCompare(record.createdAt) ||
    anchor.id.localeCompare(record.id)
  );
}

async function searchCriteriaTag(
  metadata: StoredVaultMetadata,
  query: string,
  status: "all" | "completed" | "draft",
  period: "all" | "this_month" | "last_month",
  category: "all" | LocalCustomerCategory,
): Promise<string> {
  return hmacToken(
    metadata.summaryAuthKey,
    JSON.stringify([
      "search-criteria",
      query.toLocaleLowerCase(),
      status,
      period,
      category,
    ]),
  );
}

async function encodeSearchCursor(
  metadata: StoredVaultMetadata,
  criteriaTag: string,
  record: StoredCustomerRecord,
): Promise<string> {
  const body = bytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify([
        1,
        metadata.vaultId,
        criteriaTag,
        record.createdAt,
        record.id,
      ]),
    ),
  );
  const signature = await hmacToken(metadata.summaryAuthKey, `search-cursor|${body}`);
  return `${body}.${signature}`;
}

async function decodeSearchCursor(
  metadata: StoredVaultMetadata,
  cursor: string,
  criteriaTag: string,
): Promise<SearchCursorAnchor> {
  const invalid = () => new LocalVaultValidationError("分页游标无效。");
  if (
    typeof cursor !== "string" ||
    cursor.length > 1024 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor)
  ) {
    throw invalid();
  }
  const [body, signature] = cursor.split(".");
  const expected = await hmacToken(metadata.summaryAuthKey, `search-cursor|${body}`);
  if (!constantTimeAsciiEqual(expected, signature)) throw invalid();
  try {
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(base64UrlBytes(body)),
    ) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 5) throw invalid();
    const [version, vaultId, cursorCriteria, createdAt, id] = parsed;
    if (
      version !== 1 ||
      vaultId !== metadata.vaultId ||
      cursorCriteria !== criteriaTag ||
      typeof createdAt !== "string" ||
      !Number.isFinite(Date.parse(createdAt)) ||
      new Date(createdAt).toISOString() !== createdAt ||
      typeof id !== "string"
    ) {
      throw invalid();
    }
    return { createdAt, id: validateRecordId(id) };
  } catch (error) {
    if (error instanceof LocalVaultValidationError && error.message === "分页游标无效。") {
      throw error;
    }
    throw invalid();
  }
}

function base64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

type NormalizedInput = {
  name: string;
  shopName: string | null;
  phone: string;
  phoneDigits: string;
  maskedPhone: string;
  idCardFront: Uint8Array | null;
  idCardBack: Uint8Array | null;
  idCardFrontType: string | null;
  idCardBackType: string | null;
  bankCardNumber: string | null;
  profileStatus: "completed" | "draft";
  category: LocalCustomerCategory;
  machineType: CustomerMachineType | null;
  machineMode: CustomerMachineMode | null;
  feeRate: number | null;
  createdAt: string;
};

async function normalizeInput(input: SaveLocalCustomerInput): Promise<NormalizedInput> {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new LocalVaultValidationError("客户姓名无效。");
  const shopName = input.shopName?.trim() || null;
  if (shopName && shopName.length > 120) {
    throw new LocalVaultValidationError("店铺名字不能超过 120 个字符。");
  }
  const phone = input.phone.replace(/[\s-]/g, "");
  if (!/^\+?\d{7,20}$/.test(phone)) throw new LocalVaultValidationError("客户手机号无效。");
  if (input.idCardFront) validateImage(input.idCardFront);
  if (input.idCardBack) validateImage(input.idCardBack);
  const [front, back] = await Promise.all([
    input.idCardFront ? input.idCardFront.arrayBuffer() : Promise.resolve(null),
    input.idCardBack ? input.idCardBack.arrayBuffer() : Promise.resolve(null),
  ]);
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new LocalVaultValidationError("录入时间无效。");
  const machineType = input.machineType ?? null;
  const machineMode = input.machineMode ?? null;
  const feeRate = input.feeRate ?? null;
  if (
    (machineType !== null && !isCustomerMachineType(machineType)) ||
    (machineType === null && (machineMode !== null || feeRate !== null)) ||
    (machineType !== null && (!isCustomerMachineMode(machineMode) || !isValidCustomerFeeRate(feeRate)))
  ) {
    throw new LocalVaultValidationError("请选择机器、购买方式并填写有效费率。");
  }
  return {
    name,
    shopName,
    phone,
    phoneDigits: phone.replace(/\D/g, ""),
    maskedPhone: maskPhone(phone),
    idCardFront: front ? new Uint8Array(front) : null,
    idCardBack: back ? new Uint8Array(back) : null,
    idCardFrontType: input.idCardFront
      ? input.idCardFront.type || "application/octet-stream"
      : null,
    idCardBackType: input.idCardBack
      ? input.idCardBack.type || "application/octet-stream"
      : null,
    bankCardNumber: input.bankCardNumber ? normalizeBankCard(input.bankCardNumber) : null,
    profileStatus: input.idCardFront && input.idCardBack ? "completed" : "draft",
    category: normalizeCategory(input.category ?? "直营"),
    machineType,
    machineMode,
    feeRate,
    createdAt: new Date(createdAt).toISOString(),
  };
}

async function createVaultMetadata(
  scopeKey: string,
  password: string,
  unlockSecret: Uint8Array,
): Promise<{ metadata: StoredVaultMetadata; masterKey: CryptoKey; rawMasterKey: Uint8Array }> {
  const vaultId = randomId("vault_");
  const rawMasterKey = randomBytes(32);
  const kdfSalt = randomBytes(16);
  const wrapIv = randomBytes(12);
  const phoneIndexSalt = randomBytes(16);
  const summaryAuthSalt = randomBytes(16);
  const [masterKey, wrappingKey, phoneIndexKey, summaryAuthKey] = await Promise.all([
    importMasterKey(rawMasterKey),
    deriveWrappingKey(password, unlockSecret, kdfSalt),
    derivePhoneIndexKey(rawMasterKey, phoneIndexSalt, scopeKey, vaultId),
    deriveSummaryAuthKey(rawMasterKey, summaryAuthSalt, scopeKey, vaultId),
  ]);
  const wrappedMasterKey = new Uint8Array(
    await webCrypto().subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(wrapIv),
        additionalData: toArrayBuffer(aadFor(scopeKey, vaultId, "vault", "master-key")),
        tagLength: 128,
      },
      wrappingKey,
      toArrayBuffer(rawMasterKey),
    ),
  );
  return {
    metadata: {
      scopeKey,
      schemaVersion: LOCAL_VAULT_SCHEMA_VERSION,
      vaultId,
      iterations: PBKDF2_ITERATIONS,
      kdfSalt,
      wrapIv,
      wrappedMasterKey,
      phoneIndexSalt,
      phoneIndexKey,
      summaryAuthSalt,
      summaryAuthKey,
      createdAt: new Date().toISOString(),
    },
    masterKey,
    rawMasterKey,
  };
}

async function unlockMasterKey(
  metadata: StoredVaultMetadata,
  password: string,
  unlockSecret: Uint8Array,
): Promise<CryptoKey> {
  validateVaultMetadata(metadata, metadata.scopeKey);
  try {
    const wrappingKey = await deriveWrappingKey(
      password,
      unlockSecret,
      metadata.kdfSalt,
      metadata.iterations,
    );
    const raw = new Uint8Array(
      await webCrypto().subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(metadata.wrapIv),
          additionalData: toArrayBuffer(aadFor(metadata.scopeKey, metadata.vaultId, "vault", "master-key")),
          tagLength: 128,
        },
        wrappingKey,
        toArrayBuffer(metadata.wrappedMasterKey),
      ),
    );
    try {
      return await importMasterKey(raw);
    } finally {
      raw.fill(0);
    }
  } catch (error) {
    if (error instanceof LocalVaultValidationError) throw error;
    throw new LocalVaultAuthenticationError({ cause: error });
  }
}

async function encryptCustomer(
  metadata: StoredVaultMetadata,
  masterKey: CryptoKey,
  input: NormalizedInput,
  id: string,
  storageKey: string,
): Promise<StoredCustomerRecord> {
  const tokens = await Promise.all(
      phoneFragments(input.phoneDigits).map((fragment) => hmacToken(metadata.phoneIndexKey, fragment)),
  );
  const scopedTokens = tokens.map((token) => scopedPhoneToken(metadata.scopeKey, token));
  const [phone, idCardFront, idCardBack, bankCard] = await Promise.all([
      encryptText(masterKey, input.phone, aadFor(metadata.scopeKey, metadata.vaultId, id, "phone")),
      input.idCardFront && input.idCardFrontType
        ? encryptBytes(
            masterKey,
            input.idCardFront,
            aadFor(metadata.scopeKey, metadata.vaultId, id, `id-card-front|${input.idCardFrontType}`),
          )
        : Promise.resolve(null),
      input.idCardBack && input.idCardBackType
        ? encryptBytes(
            masterKey,
            input.idCardBack,
            aadFor(metadata.scopeKey, metadata.vaultId, id, `id-card-back|${input.idCardBackType}`),
          )
        : Promise.resolve(null),
      input.bankCardNumber
        ? encryptText(masterKey, input.bankCardNumber, aadFor(metadata.scopeKey, metadata.vaultId, id, "bank-card-pan"))
        : Promise.resolve(null),
    ]);
  const record: StoredCustomerRecord = {
      storageKey,
      scopeKey: metadata.scopeKey,
      schemaVersion: metadata.schemaVersion,
      vaultId: metadata.vaultId,
      id,
      name: input.name,
      shopName: input.shopName,
      maskedPhone: input.maskedPhone,
      profileStatus: input.profileStatus,
      category: input.category,
      machineType: input.machineType,
      machineMode: input.machineMode,
      feeRate: input.feeRate,
      createdAt: input.createdAt,
      idCardFrontType: input.idCardFrontType,
      idCardBackType: input.idCardBackType,
      hasBankCard: Boolean(bankCard),
      phoneTokens: scopedTokens,
      summaryAuthTag: "",
      encrypted: { phone, idCardFront, idCardBack, bankCard },
  };
  record.summaryAuthTag = await summaryAuthTag(metadata, record);
  return record;
}

async function sensitiveContext(storage: LocalVaultStorage, id: string, session: LocalVaultSession) {
  const secret = requireSessionSecret(session);
  const validId = validateRecordId(id);
  const scopeKey = await scopeDigest(secret.userScope);
  const [metadata, record] = await Promise.all([
    storage.getVault(scopeKey),
    storage.getCustomer(customerStorageKey(scopeKey, validId)),
  ]);
  if (!metadata || !record) throw new LocalVaultNotFoundError();
  await authenticateRecord(metadata, record);
  if (
    Boolean(record.idCardFrontType) !== Boolean(record.encrypted.idCardFront) ||
    Boolean(record.idCardBackType) !== Boolean(record.encrypted.idCardBack)
  ) {
    throw new LocalVaultIntegrityError();
  }
  return {
    metadata,
    record,
    masterKey: await unlockMasterKey(metadata, secret.password, secret.unlockSecret),
  };
}

function fieldAad(context: { metadata: StoredVaultMetadata; record: StoredCustomerRecord }, field: string) {
  return aadFor(context.metadata.scopeKey, context.metadata.vaultId, context.record.id, field);
}

function blobFieldAad(
  context: { metadata: StoredVaultMetadata; record: StoredCustomerRecord },
  field: string,
  mimeType: string,
) {
  if (!isSafeImageType(mimeType)) throw new LocalVaultIntegrityError();
  return fieldAad(context, `${field}|${mimeType}`);
}

function summaryFromRecord(record: StoredCustomerRecord): LocalCustomerSummary {
  return {
    id: record.id,
    name: record.name,
    shopName: record.shopName ?? null,
    maskedPhone: record.maskedPhone,
    profileStatus: record.profileStatus,
    category: record.category ?? "直营",
    machineType: record.machineType ?? null,
    machineMode: record.machineMode ?? null,
    feeRate: record.feeRate ?? null,
    createdAt: record.createdAt,
    idCard: {
      frontUploaded: Boolean(record.idCardFrontType),
      backUploaded: Boolean(record.idCardBackType),
    },
    hasBankCard: record.hasBankCard,
  };
}

function validateVaultMetadata(metadata: StoredVaultMetadata, scopeKey: string): void {
  if (
    metadata.scopeKey !== scopeKey ||
    metadata.schemaVersion !== LOCAL_VAULT_SCHEMA_VERSION ||
    !/^vault_[0-9a-f-]{36}$/i.test(metadata.vaultId) ||
    metadata.iterations !== PBKDF2_ITERATIONS ||
    !(metadata.kdfSalt instanceof Uint8Array) ||
    metadata.kdfSalt.byteLength !== 16 ||
    !(metadata.wrapIv instanceof Uint8Array) ||
    metadata.wrapIv.byteLength !== 12 ||
    !(metadata.wrappedMasterKey instanceof Uint8Array) ||
    metadata.wrappedMasterKey.byteLength !== 48 ||
    !(metadata.phoneIndexSalt instanceof Uint8Array) ||
    metadata.phoneIndexSalt.byteLength !== 16 ||
    !(metadata.summaryAuthSalt instanceof Uint8Array) ||
    metadata.summaryAuthSalt.byteLength !== 16
  ) {
    throw new LocalVaultIntegrityError();
  }
}

function validateRecordEnvelope(record: StoredCustomerRecord, metadata: StoredVaultMetadata): void {
  if (
    record.scopeKey !== metadata.scopeKey ||
    record.vaultId !== metadata.vaultId ||
    record.schemaVersion !== metadata.schemaVersion ||
    record.storageKey !== customerStorageKey(record.scopeKey, record.id) ||
    !record.name ||
    record.name.length > 100 ||
    (record.shopName !== undefined && record.shopName !== null &&
      (typeof record.shopName !== "string" || record.shopName.length > 120)) ||
    !/^\+?\d{3}\*{4}\d{4}$/.test(record.maskedPhone) ||
    !["completed", "draft"].includes(record.profileStatus) ||
    (record.category !== undefined && !isCustomerCategory(record.category)) ||
    (record.machineType !== undefined && record.machineType !== null &&
      !isCustomerMachineType(record.machineType)) ||
    (record.machineMode !== undefined && record.machineMode !== null &&
      !isCustomerMachineMode(record.machineMode)) ||
    (record.feeRate !== undefined && record.feeRate !== null &&
      !isValidCustomerFeeRate(record.feeRate)) ||
    ((record.machineType ?? null) === null &&
      ((record.machineMode ?? null) !== null || (record.feeRate ?? null) !== null)) ||
    ((record.machineType ?? null) !== null &&
      ((record.machineMode ?? null) === null || (record.feeRate ?? null) === null)) ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    (record.idCardFrontType !== null && !isSafeImageType(record.idCardFrontType)) ||
    (record.idCardBackType !== null && !isSafeImageType(record.idCardBackType)) ||
    typeof record.hasBankCard !== "boolean" ||
    !Array.isArray(record.phoneTokens) ||
    record.phoneTokens.length < 1 ||
    record.phoneTokens.length > 200 ||
    record.phoneTokens.some(
      (token) =>
        typeof token !== "string" ||
        !token.startsWith(`${record.scopeKey}:`) ||
        !/^[A-Za-z0-9_-]{43}$/.test(token.slice(record.scopeKey.length + 1)),
    ) ||
    !/^[A-Za-z0-9_-]{43}$/.test(record.summaryAuthTag)
  ) {
    throw new LocalVaultIntegrityError();
  }
}

async function authenticateRecord(
  metadata: StoredVaultMetadata,
  record: StoredCustomerRecord,
): Promise<void> {
  validateRecordEnvelope(record, metadata);
  const expected = await summaryAuthTag(metadata, record);
  if (!constantTimeAsciiEqual(expected, record.summaryAuthTag)) {
    throw new LocalVaultIntegrityError();
  }
}

async function summaryAuthTag(
  metadata: StoredVaultMetadata,
  record: StoredCustomerRecord,
): Promise<string> {
  const fields: unknown[] = [
      "customer-summary",
      record.storageKey,
      record.scopeKey,
      record.schemaVersion,
      record.vaultId,
      record.id,
      record.name,
      record.maskedPhone,
      record.profileStatus,
      record.createdAt,
      record.idCardFrontType,
      record.idCardBackType,
      record.hasBankCard,
      record.phoneTokens,
    ];
  // Records written before customer classification did not include this
  // authenticated field. They remain readable as "直营" until updated.
  if (record.category !== undefined) fields.push(record.category);
  if (record.shopName !== undefined) fields.push(record.shopName);
  if (
    record.machineType !== undefined ||
    record.machineMode !== undefined ||
    record.feeRate !== undefined
  ) {
    fields.push(record.machineType ?? null, record.machineMode ?? null, record.feeRate ?? null);
  }
  return hmacToken(metadata.summaryAuthKey, JSON.stringify(fields));
}

function constantTimeAsciiEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function scopedPhoneToken(scopeKey: string, token: string): string {
  return `${scopeKey}:${token}`;
}

function validateRecordId(id: string): string {
  const normalized = id.trim();
  if (!/^(?:local_[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{8}-[0-9a-f-]{27,})$/i.test(normalized)) {
    throw new LocalVaultValidationError("本机客户编号无效。");
  }
  return normalized;
}

function customerStorageKey(scopeKey: string, id: string): string {
  return `${scopeKey}:${id}`;
}

function validateImage(blob: Blob): void {
  if (!(blob instanceof Blob) || blob.size <= 0 || blob.size > MAX_BLOB_BYTES) {
    throw new LocalVaultValidationError("身份证图片大小无效。");
  }
  validateImageType(blob.type || "application/octet-stream");
}

function validateImageType(mimeType: string): void {
  // SVG/HTML-like active content is intentionally excluded from object URLs.
  if (!isSafeImageType(mimeType)) {
    throw new LocalVaultValidationError("身份证资料必须为安全的图片格式。");
  }
}

function isSafeImageType(mimeType: string): boolean {
  return /^(?:image\/(?:jpeg|png|webp|gif|avif|heic|heif)|application\/octet-stream)$/i.test(mimeType);
}

function normalizeBankCard(value: string): string {
  const normalized = value.replace(/[\s-]/g, "");
  if (!isValidBankCard(normalized)) {
    throw new LocalVaultValidationError("银行卡号需为 12～19 位数字。");
  }
  return normalized;
}

function isValidBankCard(value: string): boolean {
  return /^\d{12,19}$/.test(value);
}

function validateDecryptedPhone(value: string): void {
  if (!/^\+?\d{7,20}$/.test(value)) throw new LocalVaultIntegrityError();
}

function maskPhone(phone: string): string {
  const prefix = phone.startsWith("+") ? "+" : "";
  const digits = phone.replace(/\D/g, "");
  return `${prefix}${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

function normalizePhoneQuery(query: string): string | null {
  if (!/^[+\d\s-]+$/.test(query)) return null;
  const digits = query.replace(/\D/g, "");
  return digits.length >= 3 && digits.length <= 11 ? digits : null;
}

function normalizeFilters(filters: LocalCustomerSearchFilters) {
  const status = filters.status ?? "all";
  const period = filters.period ?? "all";
  const category = filters.category ?? "all";
  const requestedLimit = filters.limit ?? 20;
  if (!['all', 'completed', 'draft'].includes(status)) throw new LocalVaultValidationError("资料状态筛选无效。");
  if (!['all', 'this_month', 'last_month'].includes(period)) throw new LocalVaultValidationError("录入时间筛选无效。");
  if (category !== "all" && !isCustomerCategory(category)) {
    throw new LocalVaultValidationError("客户分类筛选无效。");
  }
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new LocalVaultValidationError("搜索数量无效。");
  return { status, period, category, limit: Math.min(requestedLimit, 20) } as const;
}

function isCustomerCategory(value: unknown): value is LocalCustomerCategory {
  return ["直营", "代理", "汇来米", "收银通"].includes(
    String(value),
  );
}

function normalizeCategory(value: unknown): LocalCustomerCategory {
  if (!isCustomerCategory(value)) {
    throw new LocalVaultValidationError("客户分类无效。");
  }
  return value;
}

function matchesCategory(
  record: StoredCustomerRecord,
  category: "all" | LocalCustomerCategory,
): boolean {
  return category === "all" || (record.category ?? "直营") === category;
}

function matchesStatus(record: StoredCustomerRecord, status: "all" | "completed" | "draft"): boolean {
  return status === "all" || record.profileStatus === status;
}

function matchesPeriod(createdAt: string, period: "all" | "this_month" | "last_month"): boolean {
  if (period === "all") return true;
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) throw new LocalVaultIntegrityError();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  });
  const key = (value: Date) => formatter.format(value);
  const now = new Date();
  if (period === "this_month") return key(date) === key(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const previous = new Date(Date.UTC(year, month - 2, 15, 4));
  return key(date) === key(previous);
}
