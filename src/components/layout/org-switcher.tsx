'use client';

import { Building2, Check, ChevronsUpDown, LogIn, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { OrgAvatar } from '@/components/ui/org-avatar';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrgs } from '@/hooks/use-orgs';

const ROLE_LABEL_MAP: Record<string, string> = {
  teacher: 'role_teacher',
  student: 'role_student',
  university_admin: 'role_uni_admin',
  sys_admin: 'role_sys_admin',
  free: 'role_free',
  premium: 'role_premium',
};

export function OrgSwitcher() {
  const t = useTranslations('DashboardLayout');
  const { user } = useAuth();
  const { orgs, activeOrg, switchOrg, isSwitching, isLoading } = useOrgs();
  const router = useRouter();
  const { isMobile } = useSidebar();

  if (!user) return null;

  if (isLoading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" disabled>
            <Skeleton className="size-8 rounded-lg shrink-0" />
            <div className="flex flex-col gap-1.5 leading-none group-data-[collapsible=icon]:hidden flex-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <ChevronsUpDown className="ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden text-muted-foreground" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const displayName = activeOrg?.name || 'StudiQ';
  const roleKey = ROLE_LABEL_MAP[activeOrg?.role || ''] || 'role_free';

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
                {activeOrg ? (
                  <OrgAvatar orgId={activeOrg.id} name={activeOrg.name} size={32} />
                ) : (
                  <Building2 className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-col gap-0.5 leading-none group-data-[collapsible=icon]:hidden">
                <span className="font-medium truncate max-w-32">{displayName}</span>
                <span className="text-xs text-muted-foreground truncate max-w-32">
                  {t(roleKey)}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('orgs_label')}
            </DropdownMenuLabel>
            {orgs.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => switchOrg(org.id)}
                disabled={isSwitching}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center">
                  <OrgAvatar orgId={org.id} name={org.name} size={24} />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="truncate text-sm font-medium">{org.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t(ROLE_LABEL_MAP[org.role] || 'role_free')}
                  </span>
                </div>
                {org.isActive && <Check className="ml-auto size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {user?.app_metadata?.role === 'teacher' ||
            user?.app_metadata?.role === 'university_admin' ||
            user?.app_metadata?.role === 'sys_admin' ? (
              <DropdownMenuItem
                className="gap-2 p-2 text-muted-foreground"
                onClick={() => router.push('/edu/classroom/new')}
              >
                <Plus className="size-4" />
                <span>{t('create_org')}</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="gap-2 p-2 text-muted-foreground"
                onClick={() => router.push('/app/join')}
              >
                <LogIn className="size-4" />
                <span>{t('join_org')}</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
