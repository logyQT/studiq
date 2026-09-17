import type { AccountType } from '@studiq/authz';

export function roleGuard(accountType: AccountType | undefined, allowedTypes: string[]): boolean {
  if (!accountType) return false;
  return allowedTypes.includes(accountType);
}
