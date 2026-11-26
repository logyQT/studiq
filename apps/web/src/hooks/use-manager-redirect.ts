'use client';

import { AccountType } from '@studiq/authz';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useOrgs } from '@/hooks/use-orgs';

/**
 * `/app` and `/edu` are the learner and teacher surfaces. A manager buys and
 * changes organization plans on `/manage`, so those pages send a manager there
 * instead of printing a personal purchase the checkout refuses.
 *
 * The account type is the JWT persona `/me/orgs` also reads. It decides
 * navigation only; the API still answers every request on its own.
 */
export function useManagerRedirect(target: '/manage' | '/manage/billing'): boolean {
  const router = useRouter();
  const { accountType } = useOrgs();
  const isManager = accountType === AccountType.MANAGER;

  useEffect(() => {
    if (isManager) router.replace(target);
  }, [isManager, router, target]);

  return isManager;
}
