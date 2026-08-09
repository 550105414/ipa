import { IndexedDbLocalVaultStorage } from "./storage";
import { createLocalVaultApi } from "./vault";

const browserVault = createLocalVaultApi(new IndexedDbLocalVaultStorage());

export const saveLocalCustomer = browserVault.saveLocalCustomer;
export const searchLocalCustomers = browserVault.searchLocalCustomers;
export const searchLocalCustomersPage = browserVault.searchLocalCustomersPage;
export const getLocalCustomer = browserVault.getLocalCustomer;
export const unlockLocalCustomer = browserVault.unlockLocalCustomer;
export const updateLocalBankCard = browserVault.updateLocalBankCard;
export const getLocalPhone = browserVault.getLocalPhone;
export const updateLocalCustomerCategory = browserVault.updateLocalCustomerCategory;
export const clearLocalVault = browserVault.clearLocalVault;

export {
  createLocalVaultSession,
  isLocalVaultSessionActive,
  revokeLocalCustomerAccess,
  revokeLocalVaultSession,
  watchLocalVaultSessionLifecycle,
} from "./session";
export {
  LocalVaultAuthenticationError,
  LocalVaultBlockedError,
  LocalVaultConflictError,
  LocalVaultError,
  LocalVaultIntegrityError,
  LocalVaultNotFoundError,
  LocalVaultQuotaError,
  LocalVaultSessionExpiredError,
  LocalVaultSessionRevokedError,
  LocalVaultUnavailableError,
  LocalVaultValidationError,
  LocalVaultVersionChangeError,
} from "./errors";
export type {
  LocalCustomerAccess,
  LocalCustomerCategory,
  LocalCustomerProfileStatus,
  LocalCustomerSearchFilters,
  LocalCustomerSearchPage,
  LocalCustomerSummary,
  LocalVaultScope,
  LocalVaultPageScope,
  LocalVaultSession,
  LocalVaultSessionLifecycleOptions,
  SaveLocalCustomerInput,
} from "./types";
export { LOCAL_CUSTOMER_CATEGORIES } from "./types";
