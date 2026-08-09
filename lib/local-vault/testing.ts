import { scopeDigest } from "./crypto";
import { MemoryLocalVaultStorage, type StoredCustomerRecord } from "./storage";
import { createLocalVaultApi } from "./vault";

export function createMemoryLocalVault() {
  const storage = new MemoryLocalVaultStorage();
  return {
    ...createLocalVaultApi(storage),
    snapshot: () => storage.snapshot(),
    async tamperCustomer(
      userScope: string,
      id: string,
      mutate: (record: StoredCustomerRecord) => void,
    ) {
      const scopeKey = await scopeDigest(userScope);
      storage.mutateCustomer(`${scopeKey}:${id}`, mutate);
    },
    async tamperVault(
      userScope: string,
      mutate: (metadata: import("./storage").StoredVaultMetadata) => void,
    ) {
      storage.mutateVault(await scopeDigest(userScope), mutate);
    },
  };
}

export type { StoredCustomerRecord, StoredVaultMetadata } from "./storage";
