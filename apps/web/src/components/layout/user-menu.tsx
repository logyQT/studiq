'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  Skeleton,
  UserAvatar,
  useSidebar,
} from '@studiq/ui';
import { ChevronLeft, ChevronsUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  UserMenuHeader,
  UserMenuItems,
  handleUserMenuTab,
} from '@/components/layout/user-menu-content';
import { useAuth } from '@/components/providers/AuthProvider';
import { LanguageSwitcherPanel } from '@/components/shared/language-switcher/language-switcher-panel';
import { cn } from '@/lib/utils';

interface UserMenuProps {
  className?: string;
}

export function UserMenu({ className }: UserMenuProps) {
  const { user } = useAuth();
  const { isMobile } = useSidebar();
  const t = useTranslations('DashboardLayout');
  const tl = useTranslations('LanguageSwitcher');
  const [drawerView, setDrawerView] = useState<'menu' | 'language'>('menu');
  const [open, setOpen] = useState(false);

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

  const triggerContent = (
    <>
      <UserAvatar name={userName} email={user?.email} size={20} className="size-8 rounded-lg" />
      <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate font-medium">{userName}</span>
        <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
      </div>
      <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
    </>
  );

  // Mobile: the sidebar is already a full-height Sheet, so a dropdown + popover
  // anchored to the bottom trigger has no room and floats over the nav rows
  // (#634). A bottom drawer owns its own space instead. Language is a second
  // view of the same drawer (drill-in with "back"), at a fixed height so the
  // on-screen keyboard neither resizes the drawer nor leaves a gap behind.
  if (isMobile) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <Drawer
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) setDrawerView('menu');
            }}
            // vaul lifts the whole drawer above the keyboard by default; with a
            // fixed-height view the search field already stays visible at the top.
            repositionInputs={false}
          >
            <DrawerTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className={cn(
                  'data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground',
                  className,
                )}
              >
                {triggerContent}
              </SidebarMenuButton>
            </DrawerTrigger>
            <DrawerContent className={cn('bg-popover', drawerView === 'language' && 'h-[85dvh]')}>
              {drawerView === 'menu' ? (
                <>
                  <DrawerTitle className="sr-only">{t('user_menu')}</DrawerTitle>
                  <div className="overflow-y-auto px-3 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <UserMenuHeader />
                    <div className="my-1 h-px bg-border" />
                    <UserMenuItems
                      variant="plain"
                      onItemClick={() => setOpen(false)}
                      onOpenLanguage={() => setDrawerView('language')}
                    />
                  </div>
                </>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  {/* Platform-style header: back on the left, centred title. */}
                  <div className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center pb-3">
                    <button
                      type="button"
                      aria-label={tl('back')}
                      onClick={() => setDrawerView('menu')}
                      className="-ml-2 grid size-11 place-items-center rounded-full outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronLeft aria-hidden="true" className="size-5" />
                    </button>
                    <DrawerTitle className="text-center text-base font-semibold">
                      {tl('label')}
                    </DrawerTitle>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <LanguageSwitcherPanel
                      fill
                      autoFocus={false}
                      onDismiss={() => setDrawerView('menu')}
                    />
                  </div>
                </div>
              )}
            </DrawerContent>
          </Drawer>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className={cn(
                'data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground',
                className,
              )}
            >
              {triggerContent}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side="right"
            align="end"
            sideOffset={4}
            onKeyDown={(event) => handleUserMenuTab(event, () => setOpen(false))}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <UserMenuHeader />
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <UserMenuItems notifications onItemClick={() => setOpen(false)} />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
