'use client';

import { AccountType } from '@studiq/authz';
import { DropdownMenuItem, DropdownMenuSeparator, UserAvatar } from '@studiq/ui';
import {
  BadgeCheck,
  Bell,
  Check,
  CreditCard,
  Globe,
  LogOut,
  Moon,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useAuth } from '@/components/providers/AuthProvider';
import { OPEN_NOTIFICATIONS_EVENT } from '@/lib/notifications';
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

export function UserMenuHeader() {
  const { user } = useAuth();
  const t = useTranslations('DashboardLayout');
  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || t('default_user');

  return (
    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
      <UserAvatar name={userName} email={user?.email} size={20} className="size-8 rounded-lg" />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{userName}</span>
        <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
      </div>
    </div>
  );
}

const PLAIN_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground transition-colors';

interface MenuEntryProps {
  variant: UserMenuVariant;
  onSelect?: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}

/**
 * Renders a real Radix `DropdownMenuItem` inside a dropdown (keyboard reachable via
 * roving focus), or a plain button when rendered outside a menu context (e.g. a Sheet).
 */
function MenuEntry({ variant, onSelect, destructive, children }: MenuEntryProps) {
  if (variant === 'menu') {
    return (
      <DropdownMenuItem variant={destructive ? 'destructive' : 'default'} onSelect={onSelect}>
        {children}
      </DropdownMenuItem>
    );
  }
  return (
    <button
      type="button"
      className={cn(
        PLAIN_ITEM_CLASS,
        destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive',
      )}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

function MenuDivider({ variant }: { variant: UserMenuVariant }) {
  return variant === 'menu' ? <DropdownMenuSeparator /> : <div className="h-px bg-border my-1" />;
}

export type UserMenuVariant = 'menu' | 'plain';

export function UserMenuItems({
  onItemClick,
  variant = 'menu',
  notifications = false,
}: {
  onItemClick?: () => void;
  /**
   * Offer the notifications entry. It opens the bell of the dashboard header, so it is only for
   * menus inside a dashboard: the public pages have no bell and the entry would do nothing.
   */
  notifications?: boolean;
  /** 'menu' inside a Radix DropdownMenuContent; 'plain' for non-menu contexts such as a Sheet. */
  variant?: UserMenuVariant;
}) {
  const t = useTranslations('DashboardLayout');
  const router = useRouter();
  const { user } = useAuth();
  const locale = getLocale();
  const { setTheme } = useTheme();

  const accountType = user?.app_metadata?.account_type as AccountType | undefined;
  const dashboardPrefix = (() => {
    switch (accountType) {
      case AccountType.EDUCATOR:
        return '/edu';
      case AccountType.MANAGER:
        return '/manage';
      default:
        return '/app';
    }
  })();

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
    <>
      <MenuEntry
        variant={variant}
        onSelect={() => {
          router.push(`${dashboardPrefix}/upgrade`);
          onItemClick?.();
        }}
      >
        <Sparkles className="size-4" />
        <span>{t('upgrade')}</span>
      </MenuEntry>

      <MenuDivider variant={variant} />

      <MenuEntry
        variant={variant}
        onSelect={() => {
          router.push(`${dashboardPrefix}/account`);
          onItemClick?.();
        }}
      >
        <BadgeCheck className="size-4 text-muted-foreground" />
        <span>{t('account')}</span>
      </MenuEntry>
      <MenuEntry
        variant={variant}
        onSelect={() => {
          router.push(`${dashboardPrefix}/billing`);
          onItemClick?.();
        }}
      >
        <CreditCard className="size-4 text-muted-foreground" />
        <span>{t('billing')}</span>
      </MenuEntry>
      {notifications && (
        <MenuEntry
          variant={variant}
          onSelect={() => {
            // The notification centre is the bell in the header; this opens it.
            window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
            onItemClick?.();
          }}
        >
          <Bell className="size-4 text-muted-foreground" />
          <span>{t('notifications')}</span>
        </MenuEntry>
      )}

      <MenuDivider variant={variant} />

      <MenuEntry
        variant={variant}
        onSelect={() => {
          changeLanguage('pl');
          onItemClick?.();
        }}
      >
        <Globe className="size-4 text-muted-foreground" />
        <span>Polski</span>
        {locale === 'pl' && <Check className="ml-auto size-4" />}
      </MenuEntry>
      <MenuEntry
        variant={variant}
        onSelect={() => {
          changeLanguage('en');
          onItemClick?.();
        }}
      >
        <Globe className="size-4 text-muted-foreground" />
        <span>English</span>
        {locale === 'en' && <Check className="ml-auto size-4" />}
      </MenuEntry>

      <MenuDivider variant={variant} />

      <MenuEntry
        variant={variant}
        onSelect={() => {
          const isDark = document.documentElement.classList.contains('dark');
          setTheme(isDark ? 'light' : 'dark');
          onItemClick?.();
        }}
      >
        <div className="relative size-4">
          <Sun className="size-4 absolute rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="size-4 absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </div>
        <span>{t('theme')}</span>
      </MenuEntry>

      <MenuDivider variant={variant} />

      <MenuEntry
        variant={variant}
        onSelect={() => {
          handleLogout();
          onItemClick?.();
        }}
        destructive
      >
        <LogOut className="size-4" />
        <span>{t('logout')}</span>
      </MenuEntry>
    </>
  );
}
