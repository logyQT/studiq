'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { apiGet, apiPost } from '@/lib/api';

export type OrgMembership = {
  id: string;
  name: string;
  slug: string;
  orgRoleName: string;
  orgRoleId: string;
  isActive: boolean;
};

export function useOrgs() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const hasAutoSelected = useRef(false);

  const { data: orgs = [], isLoading } = useQuery<OrgMembership[]>({
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
      queryClient.invalidateQueries({ queryKey: ['orgs'] });
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
  const needsOnboarding =
    !isLoading &&
    orgs.length === 0 &&
    (jwtAccountType === 'educator' || jwtAccountType === 'manager');

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
