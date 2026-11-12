'use client';

import { useEffect } from 'react';
import { useOrgs } from '@/hooks/use-orgs';
import { canLoadOrgScoped } from '@/lib/org-scoped-load';

/**
 * Runs an org-scoped `load` once the caller has an active org, and again when the
 * active org changes. Before that the screen shows its skeleton, which is what
 * keeps a hard-loaded `/manage` deep link from firing a cookie-less request and
 * rendering the 403 error card — see `canLoadOrgScoped` (#1125).
 */
export function useOrgScopedLoad(load: () => void | Promise<void>): void {
  const { activeOrg } = useOrgs();
  const activeOrgId = activeOrg?.id;

  useEffect(() => {
    if (!canLoadOrgScoped(activeOrgId)) return;
    void load();
  }, [activeOrgId, load]);
}
