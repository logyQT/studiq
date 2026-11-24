'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { apiGet, apiPost } from '@/lib/api';
import { type DashboardArea, resolveDashboardArea } from '@/lib/dashboard-home';
import { resolveNeedsOnboarding } from '@/lib/onboarding';
import { fetchPermissions } from '@/lib/permissions';
import { invalidateAuthority } from '@/lib/query-cache';
import { permissionKeys } from '@/lib/query-keys';

export type OrgMembership = {
  id: string;
  name: string;
  slug: string;
  orgRoleName: string;
  /** Localised role label from `org_roles.display_name`, when the API sends it. */
  orgRoleDisplayName?: string;
  orgRoleId: string;
  isActive: boolean;
  /** Org branding (issue #108) — only honored when the `branding` feature is on. */
  logo_url?: string | null;
  brand_color?: string | null;
};

type SwitchOrgVariables = {
  orgId: string;
  /** Explicit user-initiated switch → land on the new org's dashboard area. */
  navigate?: boolean;
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
    isError,
    refetch,
  } = useQuery<OrgMembership[]>({
    queryKey: ['orgs'],
    queryFn: () => apiGet<OrgMembership[]>('/api/v1/me/orgs'),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const switchOrgMutation = useMutation({
    mutationFn: async ({ orgId }: SwitchOrgVariables) => {
      await apiPost('/api/v1/me/orgs/switch', { orgId });
    },
    onSuccess: async (_data, { orgId, navigate }) => {
      // The active org is server state (the `active_org_id` cookie) that has
      // just changed. Flip the cached isActive flag immediately so org-scoped
      // query keys re-resolve on this tick instead of waiting for the
      // /api/v1/me/orgs refetch, which would leave the old org's key (and its
      // cached rows) observed while the new cookie is already live.
      queryClient.setQueryData<OrgMembership[]>(['orgs'], (prev) =>
        prev?.map((o) => ({ ...o, isActive: o.id === orgId })),
      );
      void queryClient.invalidateQueries({ queryKey: ['orgs'] });

      // Permission scopes, entitlements, the effective plan, the AI budget and
      // the report inbox are all resolved from the active org on the server, so
      // every one of them is now a stale answer about the previous org. The
      // org-partitioned pair is only marked stale: refetching now would write
      // the new org's payload under the outgoing org's key. The remaining
      // org-keyed lists (`activeOrg.id` in the key) are not invalidated at all
      // for the same reason — the key change is what drives their refetch
      // (#135, #216).
      invalidateAuthority(queryClient, { refetchPartitioned: false });

      // `navigate` is only set for an explicit user-initiated switch. The
      // implicit auto-select below must not push a dashboard URL: it runs right
      // after login and would override the `?next=` deep link (#458).
      if (!navigate) return;

      // The area is a function of the *new* org's permissions, so read them
      // under the new cookie before deciding; the outgoing org's map describes a
      // role this caller no longer holds. `fetchQuery` also writes the answer
      // under the new org's key, which is what the shell reads next.
      let area: DashboardArea = '/app';
      try {
        const fresh = await queryClient.fetchQuery({
          queryKey: permissionKeys.org(orgId),
          // `fetchQuery` stores whatever the endpoint answers under `orgId`'s
          // key. A payload that names another org is a request that raced the
          // cookie change; refusing it inside the query function rejects the
          // result instead of caching it under the new key (design §3.4).
          queryFn: async () => {
            const payload = await fetchPermissions();
            if (payload.orgId !== orgId) {
              throw new Error(`permissions payload names ${payload.orgId}, expected ${orgId}`);
            }
            return payload;
          },
          staleTime: 0,
        });
        area = resolveDashboardArea(fresh.permissions);
      } catch {
        // The switch itself succeeded and the shell will retry the map; falling
        // through to `/app` beats stranding the caller on the old page.
      }
      router.push(area);
    },
  });

  const activeOrg = orgs.find((o) => o.isActive) || null;
  const rawAccountType: unknown = user?.app_metadata.account_type;
  const jwtAccountType = typeof rawAccountType === 'string' ? rawAccountType : undefined;
  const needsOnboarding = resolveNeedsOnboarding({
    orgsCount: orgs.length,
    isPending,
    isFetching,
    accountType: jwtAccountType,
  });

  const firstOrg = orgs[0];

  useEffect(() => {
    if (needsOnboarding || !firstOrg) return;
    if (!isLoading && !activeOrg && !hasAutoSelected.current) {
      hasAutoSelected.current = true;
      // No `navigate`: right after login this runs while the user is being
      // routed to the `?next=` deep link, and a dashboard push would win (#458).
      switchOrgMutation.mutate({ orgId: firstOrg.id });
    }
  }, [needsOnboarding, firstOrg, activeOrg, isLoading, switchOrgMutation]);

  return {
    orgs,
    activeOrg,
    isLoading,
    isError,
    refetch,
    // The JWT claim is the caller's declared persona. Only the onboarding
    // exception reads it (the landing's `/setup*` split); authorization never
    // does, and no area is chosen from it.
    accountType: jwtAccountType,
    // `true` until `['orgs']` settles. Org-scoped list queries gate on this so
    // they do not fetch under a `null` org and then refetch under the real one
    // (content → skeleton → content flicker on a cold load).
    isPending,
    // `true` whenever a request is in flight, including a background refetch
    // over cached data. The onboarding guards need the settled rule
    // (`!isPending && !isFetching`) so they never decide on stale data (#305).
    isFetching,
    needsOnboarding,
    switchOrg: (orgId: string) => switchOrgMutation.mutate({ orgId, navigate: true }),
    isSwitching: switchOrgMutation.isPending,
  };
}
