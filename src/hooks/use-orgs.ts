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
  role: string;
  isActive: boolean;
};

const ROLE_DASHBOARD: Record<string, string> = {
  teacher: '/edu',
  university_admin: '/manage',
  sys_admin: '/admin',
  student: '/app',
  free: '/app',
  premium: '/app',
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orgs'] });
      const role = user?.app_metadata?.role as string;
      router.push(ROLE_DASHBOARD[role] || '/app');
    },
  });

  const activeOrg = orgs.find((o) => o.isActive) || null;

  useEffect(() => {
    if (!isLoading && orgs.length > 0 && !activeOrg && !hasAutoSelected.current) {
      hasAutoSelected.current = true;
      switchOrgMutation.mutate(orgs[0].id);
    }
  }, [orgs, activeOrg, isLoading, switchOrgMutation]);

  return {
    orgs,
    isLoading,
    activeOrg,
    switchOrg: switchOrgMutation.mutateAsync,
    isSwitching: switchOrgMutation.isPending,
  };
}
