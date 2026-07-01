'use client';

import { ChevronsUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { UserAvatar } from '@/components/ui/user-avatar';
import { cn } from '@/lib/utils';
import { UserMenuHeader, UserMenuItems } from './user-menu-content';

interface UserMenuProps {
  className?: string;
}

export function UserMenu({ className }: UserMenuProps) {
  const { user } = useAuth();
  const t = useTranslations('DashboardLayout');
  const { isMobile } = useSidebar();

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || t('default_user');

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className={cn(
                'data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground',
                className,
              )}
            >
              <UserAvatar
                name={userName}
                email={user?.email}
                size={20}
                className="size-8 rounded-lg"
              />
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{userName}</span>
                <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <UserMenuHeader />
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <UserMenuItems />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
