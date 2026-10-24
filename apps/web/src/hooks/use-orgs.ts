'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { apiGet, apiPost } from '@/lib/api';
import { resolveNeedsOnboarding } from '@/lib/onboarding';
import { featureKeys, permissionKeys, questionReportKeys } from '@/lib/query-keys';

export type OrgMembership = {
  id: string;
  name: string;
  slug: string;
  orgRoleName: string;
  orgRoleId: string;
  isActive: boolean;
  /** Org branding (issue #108) — only honored when the `branding` feature is on. */
  logo_url?: string | null;
  brand_color?: string | null;
};

export function useOrgs() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const hasAutoSelected = useRef(false);

  const {
    data: orgs = [],
    isLoading,
    isPending,
    isFetching,
  } = useQuery<OrgMembership[]>({
    queryKey: ['orgs'],
    queryFn: () => apiGet<OrgMembership[]>('/api/v1/me/orgs'),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const switchOrgMutation = useMutation({
    mutationFn: async (orgId: string) => {
      await apiPost('/api/v1/me/orgs/switch', { orgId });
    },
    onSuccess: (_data, variables) => {
      // The active org is server state (the `active_org_id` cookie) that has
      // just changed. Flip the cached isActive flag immediately so org-scoped
      // query keys re-resolve on this tick instead of waiting for the
      // /api/v1/me/orgs refetch, which would leave the old org's key (and its
      // cached rows) observed while the new cookie is already live.
      queryClient.setQueryData<OrgMembership[]>(['orgs'], (prev) =>
        prev?.map((o) => ({ ...o, isActive: o.id === variables })),
      );
      queryClient.invalidateQueries({ queryKey: ['orgs'] });

      // Permission scopes and plan features are resolved from the active org
      // on the server and both hooks cache for 5 minutes.
      queryClient.invalidateQueries({ queryKey: permissionKeys.all });
      queryClient.invalidateQueries({ queryKey: featureKeys.all });

      // Report rows are scoped to the active org for an org admin, so the
      // previous org's inbox (`staleTime: Infinity`) must not survive a switch.
      queryClient.invalidateQueries({ queryKey: questionReportKeys.all });

      // Org-keyed query entries are intentionally not invalidated here: at this
      // point the observed org key may still be the previous one, so an active
      // refetch would write the new org's rows under the old org's cache key.
      // The key change is what drives their refetch.
      const switchedOrg = orgs.find((o) => o.id === variables);
      const jwtAccountType = user?.app_metadata?.account_type as string | undefined;
      const ROLE_TO_ACCOUNT_TYPE: Record<string, string> = {
        admin: 'manager',
        teacher: 'educator',
        member: 'student',
      };
      const accountType =
        jwtAccountType ?? ROLE_TO_ACCOUNT_TYPE[switchedOrg?.orgRoleName ?? ''] ?? 'student';
      router.push(
        accountType === 'manager' ? '/manage' : accountType === 'educator' ? '/edu' : '/app',
      );
    },
  });

  const activeOrg = orgs.find((o) => o.isActive) || null;
  const jwtAccountType = user?.app_metadata?.account_type as string | undefined;
  const needsOnboarding = resolveNeedsOnboarding({
    orgsCount: orgs.length,
    isPending,
    isFetching,
    accountType: jwtAccountType,
  });

  useEffect(() => {
    if (needsOnboarding) return;
    if (!isLoading && orgs.length > 0 && !activeOrg && !hasAutoSelected.current) {
      hasAutoSelected.current = true;
      switchOrgMutation.mutate(orgs[0].id);
    }
  }, [needsOnboarding, orgs, activeOrg, isLoading, switchOrgMutation]);

  return {
    orgs,
    activeOrg,
    isLoading,
    needsOnboarding,
    switchOrg: switchOrgMutation.mutate,
    isSwitching: switchOrgMutation.isPending,
  };
}
