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
 * `enabled` makes the rule conditional for a surface that is not personal-only:
 * `/checkout` also sells organization plans to a manager, so it passes
 * `plan.scope === 'personal'` and keeps the organization form.
 *
 * The account type is the JWT persona `/me/orgs` also reads. It decides
 * navigation only; the API still answers every request on its own.
 */
export function useManagerRedirect(target: '/manage' | '/manage/billing', enabled = true): boolean {
  const router = useRouter();
  const { accountType } = useOrgs();
  const blocked = enabled && accountType === AccountType.MANAGER;

  useEffect(() => {
    if (blocked) router.replace(target);
  }, [blocked, router, target]);

  return blocked;
}
