import {
  LocalVaultBlockedError,
  LocalVaultConflictError,
  LocalVaultVersionChangeError,
  mapStorageError,
} from "./errors";
import type { EncryptedBytes } from "./crypto";
import type {
  LocalCustomerCategory,
  LocalCustomerProfileStatus,
} from "./types";
import type { CustomerMachineMode, CustomerMachineType } from "@/lib/customers/machine";

const DATABASE_NAME = "sales-workspace-local-vault";
const DATABASE_VERSION = 2;
const VAULT_STORE = "vaults";
const CUSTOMER_STORE = "customers";
const PAYLOAD_STORE = "customer_payloads";
const SCOPE_CREATED_INDEX = "by_scope_created_at";
const PHONE_TOKEN_INDEX = "by_phone_token";

export type StoredVaultMetadata = {
  scopeKey: string;
  schemaVersion: number;
  vaultId: string;
  iterations: number;
  kdfSalt: Uint8Array;
  wrapIv: Uint8Array;
  wrappedMasterKey: Uint8Array;
  phoneIndexSalt: Uint8Array;
  phoneIndexKey: CryptoKey;
  summaryAuthSalt: Uint8Array;
  summaryAuthKey: CryptoKey;
  createdAt: string;
};

export type StoredCustomerRecord = {
  storageKey: string;
  scopeKey: string;
  schemaVersion: number;
  vaultId: string;
  id: string;
  name: string;
  shopName?: string | null;
  maskedPhone: string;
  profileStatus: LocalCustomerProfileStatus;
  category?: LocalCustomerCategory;
  machineType?: CustomerMachineType | null;
  machineMode?: CustomerMachineMode | null;
  feeRate?: number | null;
  depositAmount?: number | null;
  address?: string | null;
  tags?: string[];
  createdAt: string;
  idCardFrontType: string | null;
  idCardBackType: string | null;
  businessLicenseType?: string | null;
  hasBankCard: boolean;
  phoneTokens: string[];
  summaryAuthTag: string;
  encrypted: {
    phone: EncryptedBytes;
    idCardFront: EncryptedBytes | null;
    idCardBack: EncryptedBytes | null;
    businessLicense?: EncryptedBytes | null;
    bankCard: EncryptedBytes | null;
  };
};

type StoredCustomerSummaryRecord = Omit<StoredCustomerRecord, "encrypted">;
type StoredCustomerPayload = Pick<StoredCustomerRecord, "storageKey" | "encrypted">;

export interface LocalVaultStorage {
  getVault(scopeKey: string): Promise<StoredVaultMetadata | null>;
  getCustomerSummary(storageKey: string): Promise<StoredCustomerRecord | null>;
  getCustomer(storageKey: string): Promise<StoredCustomerRecord | null>;
  listCustomers(scopeKey: string, scopedPhoneToken?: string): Promise<StoredCustomerRecord[]>;
  commitNewVaultAndCustomer(
    metadata: StoredVaultMetadata,
    customer: StoredCustomerRecord,
  ): Promise<void>;
  addCustomer(customer: StoredCustomerRecord): Promise<void>;
  putCustomer(customer: StoredCustomerRecord): Promise<void>;
  clearScope(scopeKey: string): Promise<void>;
}

export class IndexedDbLocalVaultStorage implements LocalVaultStorage {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private versionChanged = false;

  async getVault(scopeKey: string): Promise<StoredVaultMetadata | null> {
    const database = await this.database();
    const transaction = database.transaction(VAULT_STORE, "readonly");
    const result = await requestResult<StoredVaultMetadata | undefined>(
      transaction.objectStore(VAULT_STORE).get(scopeKey),
    );
    await transactionDone(transaction);
    return result ?? null;
  }

  async getCustomer(storageKey: string): Promise<StoredCustomerRecord | null> {
    const database = await this.database();
    const transaction = database.transaction([CUSTOMER_STORE, PAYLOAD_STORE], "readonly");
    const [summary, payload] = await Promise.all([
      requestResult<StoredCustomerSummaryRecord | undefined>(
      transaction.objectStore(CUSTOMER_STORE).get(storageKey),
      ),
      requestResult<StoredCustomerPayload | undefined>(
        transaction.objectStore(PAYLOAD_STORE).get(storageKey),
      ),
    ]);
    await transactionDone(transaction);
    if (!summary && !payload) return null;
    if (!summary || !payload) throw mapStorageError(new Error("incomplete customer record"));
    return { ...summary, encrypted: payload.encrypted };
  }

  async getCustomerSummary(storageKey: string): Promise<StoredCustomerRecord | null> {
    const database = await this.database();
    const transaction = database.transaction(CUSTOMER_STORE, "readonly");
    const summary = await requestResult<StoredCustomerSummaryRecord | undefined>(
      transaction.objectStore(CUSTOMER_STORE).get(storageKey),
    );
    await transactionDone(transaction);
    return summary ? { ...summary, encrypted: null as never } : null;
  }

  async listCustomers(scopeKey: string, scopedPhoneToken?: string): Promise<StoredCustomerRecord[]> {
    const database = await this.database();
    const transaction = database.transaction(CUSTOMER_STORE, "readonly");
    const store = transaction.objectStore(CUSTOMER_STORE);
    const source: IDBIndex = scopedPhoneToken
      ? store.index(PHONE_TOKEN_INDEX)
      : store.index(SCOPE_CREATED_INDEX);
    const range = scopedPhoneToken
      ? IDBKeyRange.only(scopedPhoneToken)
      : IDBKeyRange.bound([scopeKey, ""], [scopeKey, "\uffff"]);
    const summaries = await cursorResults<StoredCustomerSummaryRecord>(
      source.openCursor(range, scopedPhoneToken ? "next" : "prev"),
      (record) => record.scopeKey === scopeKey,
    );
    await transactionDone(transaction);
    // Search/list never opens the payload store. The encrypted Blob payloads
    // remain on disk until a single customer is explicitly unlocked.
    return summaries.map((summary) => ({
      ...summary,
      encrypted: null as never,
    }));
  }

  async commitNewVaultAndCustomer(
    metadata: StoredVaultMetadata,
    customer: StoredCustomerRecord,
  ): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(
      [VAULT_STORE, CUSTOMER_STORE, PAYLOAD_STORE],
      "readwrite",
    );
    const { summary, payload } = splitCustomer(customer);
    transaction.objectStore(VAULT_STORE).add(metadata);
    transaction.objectStore(CUSTOMER_STORE).add(summary);
    transaction.objectStore(PAYLOAD_STORE).add(payload);
    await transactionDone(transaction);
  }

  async addCustomer(customer: StoredCustomerRecord): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction([CUSTOMER_STORE, PAYLOAD_STORE], "readwrite");
    const { summary, payload } = splitCustomer(customer);
    transaction.objectStore(CUSTOMER_STORE).add(summary);
    transaction.objectStore(PAYLOAD_STORE).add(payload);
    await transactionDone(transaction);
  }

  async putCustomer(customer: StoredCustomerRecord): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction([CUSTOMER_STORE, PAYLOAD_STORE], "readwrite");
    const { summary, payload } = splitCustomer(customer);
    transaction.objectStore(CUSTOMER_STORE).put(summary);
    transaction.objectStore(PAYLOAD_STORE).put(payload);
    await transactionDone(transaction);
  }

  async clearScope(scopeKey: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(
      [VAULT_STORE, CUSTOMER_STORE, PAYLOAD_STORE],
      "readwrite",
    );
    const customerStore = transaction.objectStore(CUSTOMER_STORE);
    const payloadStore = transaction.objectStore(PAYLOAD_STORE);
    const index = customerStore.index(SCOPE_CREATED_INDEX);
    const range = IDBKeyRange.bound([scopeKey, ""], [scopeKey, "\uffff"]);
    const request = index.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as StoredCustomerSummaryRecord;
      customerStore.delete(record.storageKey);
      payloadStore.delete(record.storageKey);
      cursor.continue();
    };
    transaction.objectStore(VAULT_STORE).delete(scopeKey);
    await transactionDone(transaction);
  }

  private database(): Promise<IDBDatabase> {
    if (this.versionChanged) return Promise.reject(new LocalVaultVersionChangeError());
    if (!globalThis.indexedDB) {
      return Promise.reject(
        mapStorageError(new Error("IndexedDB is unavailable in this environment")),
      );
    }
    if (!this.databasePromise) {
      this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        let settled = false;
        request.onupgradeneeded = (event) => {
          const database = request.result;
          if (!database.objectStoreNames.contains(VAULT_STORE)) {
            database.createObjectStore(VAULT_STORE, { keyPath: "scopeKey" });
          }
          let customers: IDBObjectStore;
          if (!database.objectStoreNames.contains(CUSTOMER_STORE)) {
            customers = database.createObjectStore(CUSTOMER_STORE, {
              keyPath: "storageKey",
            });
          } else {
            customers = request.transaction!.objectStore(CUSTOMER_STORE);
          }
          if (!customers.indexNames.contains(SCOPE_CREATED_INDEX)) {
            customers.createIndex(SCOPE_CREATED_INDEX, ["scopeKey", "createdAt"], {
              unique: false,
            });
          }
          if (!customers.indexNames.contains(PHONE_TOKEN_INDEX)) {
            customers.createIndex(PHONE_TOKEN_INDEX, "phoneTokens", {
              unique: false,
              multiEntry: true,
            });
          }
          let payloads: IDBObjectStore;
          if (!database.objectStoreNames.contains(PAYLOAD_STORE)) {
            payloads = database.createObjectStore(PAYLOAD_STORE, { keyPath: "storageKey" });
          } else {
            payloads = request.transaction!.objectStore(PAYLOAD_STORE);
          }
          if (event.oldVersion === 1) {
            const cursorRequest = customers.openCursor();
            cursorRequest.onsuccess = () => {
              const cursor = cursorRequest.result;
              if (!cursor) return;
              const legacy = cursor.value as StoredCustomerRecord;
              if (legacy.encrypted) {
                const { summary, payload } = splitCustomer(legacy);
                payloads.put(payload);
                cursor.update(summary);
              }
              cursor.continue();
            };
          }
        };
        request.onblocked = () => {
          if (settled) return;
          settled = true;
          this.databasePromise = null;
          reject(new LocalVaultBlockedError());
        };
        request.onerror = () => {
          if (settled) return;
          settled = true;
          this.databasePromise = null;
          reject(mapStorageError(request.error));
        };
        request.onsuccess = () => {
          const database = request.result;
          if (settled) {
            database.close();
            return;
          }
          settled = true;
          database.onversionchange = () => {
            this.versionChanged = true;
            database.close();
          };
          resolve(database);
        };
      });
    }
    return this.databasePromise;
  }
}

export class MemoryLocalVaultStorage implements LocalVaultStorage {
  private readonly vaults = new Map<string, StoredVaultMetadata>();
  private readonly customers = new Map<string, StoredCustomerSummaryRecord>();
  private readonly payloads = new Map<string, StoredCustomerPayload>();

  async getVault(scopeKey: string): Promise<StoredVaultMetadata | null> {
    return clone(this.vaults.get(scopeKey) ?? null);
  }

  async getCustomer(storageKey: string): Promise<StoredCustomerRecord | null> {
    const summary = this.customers.get(storageKey);
    const payload = this.payloads.get(storageKey);
    if (!summary && !payload) return null;
    if (!summary || !payload) throw mapStorageError(new Error("incomplete customer record"));
    return clone({ ...summary, encrypted: payload.encrypted });
  }

  async getCustomerSummary(storageKey: string): Promise<StoredCustomerRecord | null> {
    const summary = this.customers.get(storageKey);
    return summary ? clone({ ...summary, encrypted: null as never }) : null;
  }

  async listCustomers(scopeKey: string, scopedPhoneToken?: string): Promise<StoredCustomerRecord[]> {
    return [...this.customers.values()]
      .filter(
        (record) =>
          record.scopeKey === scopeKey &&
          (!scopedPhoneToken || record.phoneTokens.includes(scopedPhoneToken)),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((record) => clone({ ...record, encrypted: null as never }));
  }

  async commitNewVaultAndCustomer(
    metadata: StoredVaultMetadata,
    customer: StoredCustomerRecord,
  ): Promise<void> {
    if (this.vaults.has(metadata.scopeKey) || this.customers.has(customer.storageKey)) {
      throw new LocalVaultConflictError();
    }
    const { summary, payload } = splitCustomer(customer);
    this.vaults.set(metadata.scopeKey, clone(metadata));
    this.customers.set(customer.storageKey, clone(summary));
    this.payloads.set(customer.storageKey, clone(payload));
  }

  async addCustomer(customer: StoredCustomerRecord): Promise<void> {
    if (this.customers.has(customer.storageKey)) throw new LocalVaultConflictError();
    const { summary, payload } = splitCustomer(customer);
    this.customers.set(customer.storageKey, clone(summary));
    this.payloads.set(customer.storageKey, clone(payload));
  }

  async putCustomer(customer: StoredCustomerRecord): Promise<void> {
    if (!this.customers.has(customer.storageKey)) throw new LocalVaultConflictError();
    const { summary, payload } = splitCustomer(customer);
    this.customers.set(customer.storageKey, clone(summary));
    this.payloads.set(customer.storageKey, clone(payload));
  }

  async clearScope(scopeKey: string): Promise<void> {
    this.vaults.delete(scopeKey);
    for (const [storageKey, record] of this.customers) {
      if (record.scopeKey !== scopeKey) continue;
      this.customers.delete(storageKey);
      this.payloads.delete(storageKey);
    }
  }

  snapshot(): { vaults: StoredVaultMetadata[]; customers: StoredCustomerRecord[] } {
    return {
      vaults: [...this.vaults.values()].map((value) => clone(value)),
      customers: [...this.customers.keys()].map((key) => {
        const summary = this.customers.get(key)!;
        const payload = this.payloads.get(key)!;
        return clone({ ...summary, encrypted: payload.encrypted });
      }),
    };
  }

  mutateCustomer(storageKey: string, mutate: (record: StoredCustomerRecord) => void): void {
    const summary = this.customers.get(storageKey);
    const payload = this.payloads.get(storageKey);
    const existing = summary && payload ? { ...summary, encrypted: payload.encrypted } : null;
    if (!existing) throw new LocalVaultConflictError();
    const changed = clone(existing);
    mutate(changed);
    const split = splitCustomer(changed);
    this.customers.set(storageKey, split.summary);
    this.payloads.set(storageKey, split.payload);
  }

  mutateVault(scopeKey: string, mutate: (metadata: StoredVaultMetadata) => void): void {
    const existing = this.vaults.get(scopeKey);
    if (!existing) throw new LocalVaultConflictError();
    const changed = clone(existing);
    mutate(changed);
    this.vaults.set(scopeKey, changed);
  }
}

function splitCustomer(customer: StoredCustomerRecord): {
  summary: StoredCustomerSummaryRecord;
  payload: StoredCustomerPayload;
} {
  const { encrypted, ...summary } = customer;
  return {
    summary,
    payload: { storageKey: customer.storageKey, encrypted },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(mapStorageError(request.error));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(mapStorageError(transaction.error));
    transaction.onerror = () => {
      // The abort handler owns rejection so a request error cannot be reported as success.
    };
  });
}

function cursorResults<T>(
  request: IDBRequest<IDBCursorWithValue | null>,
  include: (value: T) => boolean,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const values: T[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(values);
        return;
      }
      const value = cursor.value as T;
      if (include(value)) values.push(value);
      cursor.continue();
    };
    request.onerror = () => reject(mapStorageError(request.error));
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
