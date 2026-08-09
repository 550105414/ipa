export class LocalVaultError extends Error {
  constructor(message: string, readonly code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class LocalVaultUnavailableError extends LocalVaultError {
  constructor(message = "当前浏览器不支持安全的本机资料库。", options?: ErrorOptions) {
    super(message, "LOCAL_VAULT_UNAVAILABLE", options);
  }
}

export class LocalVaultAuthenticationError extends LocalVaultError {
  constructor(options?: ErrorOptions) {
    super("无法解锁本机资料库，请重新验证。", "LOCAL_VAULT_AUTHENTICATION_FAILED", options);
  }
}

export class LocalVaultIntegrityError extends LocalVaultError {
  constructor(options?: ErrorOptions) {
    super("本机加密资料校验失败，数据可能已损坏。", "LOCAL_VAULT_INTEGRITY_FAILED", options);
  }
}

export class LocalVaultSessionExpiredError extends LocalVaultError {
  constructor() {
    super("本机资料库会话已过期，请重新验证。", "LOCAL_VAULT_SESSION_EXPIRED");
  }
}

export class LocalVaultSessionRevokedError extends LocalVaultError {
  constructor() {
    super("本机资料库会话已撤销，请重新验证。", "LOCAL_VAULT_SESSION_REVOKED");
  }
}

export class LocalVaultNotFoundError extends LocalVaultError {
  constructor() {
    super("未找到本机客户资料。", "LOCAL_VAULT_NOT_FOUND");
  }
}

export class LocalVaultConflictError extends LocalVaultError {
  constructor() {
    super("该本机客户记录已存在。", "LOCAL_VAULT_CONFLICT");
  }
}

export class LocalVaultValidationError extends LocalVaultError {
  constructor(message: string) {
    super(message, "LOCAL_VAULT_VALIDATION_FAILED");
  }
}

export class LocalVaultQuotaError extends LocalVaultError {
  constructor(options?: ErrorOptions) {
    super("浏览器存储空间不足，本机资料未保存。", "LOCAL_VAULT_QUOTA_EXCEEDED", options);
  }
}

export class LocalVaultBlockedError extends LocalVaultError {
  constructor(options?: ErrorOptions) {
    super("本机资料库被其他页面占用，请关闭旧页面后重试。", "LOCAL_VAULT_BLOCKED", options);
  }
}

export class LocalVaultVersionChangeError extends LocalVaultError {
  constructor(options?: ErrorOptions) {
    super("本机资料库版本已变化，请刷新页面后重试。", "LOCAL_VAULT_VERSION_CHANGED", options);
  }
}

export function mapStorageError(error: unknown): LocalVaultError {
  if (error instanceof LocalVaultError) return error;
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new LocalVaultQuotaError({ cause: error });
  }
  if (error instanceof DOMException && error.name === "ConstraintError") {
    return new LocalVaultConflictError();
  }
  return new LocalVaultUnavailableError("本机资料库操作失败，请稍后重试。", {
    cause: error,
  });
}
