import type { AccountType } from '@/types';

export function roleGuard(accountType: AccountType | undefined, allowedTypes: string[]): boolean {
  if (!accountType) return false;
  return allowedTypes.includes(accountType);
}
