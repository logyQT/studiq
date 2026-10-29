import { AccountType } from '@studiq/authz';

export type DashboardHome = '/edu' | '/manage' | '/app';

/** Dashboard root for an account type: educators get `/edu`, managers `/manage`, everyone else `/app`. */
export function dashboardHomeFor(
  accountType: AccountType | string | null | undefined,
): DashboardHome {
  switch (accountType) {
    case AccountType.EDUCATOR:
      return '/edu';
    case AccountType.MANAGER:
      return '/manage';
    default:
      return '/app';
  }
}
