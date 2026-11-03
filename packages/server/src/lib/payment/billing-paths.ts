import { AccountType } from '@studiq/authz';

/**
 * The billing page that belongs to an account type (#662 §7.1).
 *
 * The Billing Portal return URL and the mock portal both used to hard-code
 * `/app/billing`, which bounced educators and managers to a student page. The
 * account type is already on the authenticated context, so every caller
 * derives it from there.
 */
export function billingPath(accountType: AccountType): string {
  if (accountType === AccountType.MANAGER) return '/manage/billing';
  if (accountType === AccountType.EDUCATOR) return '/edu/billing';
  return '/app/billing';
}
