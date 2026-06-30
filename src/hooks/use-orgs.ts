'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';

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

  return {
    orgs,
    isLoading,
    activeOrg: orgs.find((o) => o.isActive) || null,
    switchOrg: switchOrgMutation.mutateAsync,
    isSwitching: switchOrgMutation.isPending,
  };
}
