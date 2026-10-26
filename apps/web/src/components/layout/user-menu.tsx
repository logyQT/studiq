'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  Skeleton,
  UserAvatar,
  useSidebar,
} from '@studiq/ui';
import { ChevronsUpDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { UserMenuHeader, UserMenuItems } from '@/components/layout/user-menu-content';
import { useAuth } from '@/components/providers/AuthProvider';
import { LanguageSwitcherContent } from '@/components/shared/language-switcher/language-switcher-content';
import { cn } from '@/lib/utils';

interface UserMenuProps {
  className?: string;
}

export function UserMenu({ className }: UserMenuProps) {
  const { user } = useAuth();
  const { isMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /**
   * Set by the language row, consumed by the menu's `onCloseAutoFocus`: open the
   * panel only after the modal menu is unmounted, so it does not inherit
   * `pointer-events: none` or lose focus to the menu's close-autofocus.
   */
  const pendingLanguageRef = useRef(false);

  if (!user) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" disabled>
            <Skeleton className="size-8 rounded-lg shrink-0" />
            <div className="grid flex-1 gap-1.5 group-data-[collapsible=icon]:hidden">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'User';

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Popover open={languageOpen} onOpenChange={setLanguageOpen}>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <PopoverAnchor asChild>
                <SidebarMenuButton
                  ref={triggerRef}
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
              </PopoverAnchor>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              side={isMobile ? 'bottom' : 'right'}
              align="end"
              sideOffset={4}
              onCloseAutoFocus={(event) => {
                if (!pendingLanguageRef.current) return;
                pendingLanguageRef.current = false;
                event.preventDefault();
                setLanguageOpen(true);
              }}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <UserMenuHeader />
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <UserMenuItems
                onItemClick={() => setOpen(false)}
                onRequestPanel={() => {
                  pendingLanguageRef.current = true;
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <LanguageSwitcherContent
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={8}
            onDismiss={() => setLanguageOpen(false)}
            returnFocusRef={triggerRef}
          />
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
