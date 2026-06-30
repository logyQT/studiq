'use client';

import {
  BadgeCheck,
  Bell,
  Check,
  ChevronsUpDown,
  CreditCard,
  Globe,
  LogOut,
  Moon,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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

type Locale = 'pl' | 'en';

function getLocale(): Locale {
  if (typeof document === 'undefined') return 'pl';
  const match = document.cookie.match(/NEXT_LOCALE=(pl|en)/);
  return (match?.[1] as Locale) || 'pl';
}

function changeLanguage(lang: Locale) {
  document.cookie = `NEXT_LOCALE=${lang}; path=/; max-age=31536000`;
  window.location.reload();
}

interface UserMenuProps {
  className?: string;
}

export function UserMenu({ className }: UserMenuProps) {
  const { user } = useAuth();
  const t = useTranslations('DashboardLayout');
  const { setTheme } = useTheme();
  const locale = getLocale();
  const { isMobile } = useSidebar();

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || t('default_user');

  async function handleLogout() {
    try {
      const res = await fetch('/api/v1/auth/logout', { method: 'POST' });
      if (!res.ok) throw new Error('Logout failed');
      window.location.href = '/login';
    } catch {
      window.location.href = '/login';
    }
  }

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
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <UserAvatar
                  name={userName}
                  email={user?.email}
                  size={20}
                  className="size-8 rounded-lg"
                />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{userName}</span>
                  <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem className="gap-2">
                <Sparkles className="size-4" />
                <span>Upgrade to Pro</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem className="gap-2">
                <BadgeCheck className="size-4 text-muted-foreground" />
                <span>{t('account')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2">
                <CreditCard className="size-4 text-muted-foreground" />
                <span>{t('billing')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2">
                <Bell className="size-4 text-muted-foreground" />
                <span>{t('notifications')}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => changeLanguage('pl')} className="gap-2">
                <Globe className="size-4 text-muted-foreground" />
                <span>Polski</span>
                {locale === 'pl' && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => changeLanguage('en')} className="gap-2">
                <Globe className="size-4 text-muted-foreground" />
                <span>English</span>
                {locale === 'en' && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                const isDark = document.documentElement.classList.contains('dark');
                setTheme(isDark ? 'light' : 'dark');
              }}
              className="gap-2"
            >
              <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span>{t('theme')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-destructive focus:text-destructive gap-2"
            >
              <LogOut className="size-4" />
              <span>{t('logout')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
