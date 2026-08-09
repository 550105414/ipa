export function bankCardDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 19);
}

export function formatBankCardNumber(value: string): string {
  return bankCardDigits(value).replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function isValidBankCardNumber(value: string): boolean {
  const digits = bankCardDigits(value);
  return /^\d{12,19}$/.test(digits);
}
