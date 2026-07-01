'use client';

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
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useAuth } from '@/components/providers/AuthProvider';
import { UserAvatar } from '@/components/ui/user-avatar';

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

export function UserMenuItems({ onItemClick }: { onItemClick?: () => void }) {
  const t = useTranslations('DashboardLayout');
  const locale = getLocale();
  const { setTheme } = useTheme();

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
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground transition-colors"
        onClick={onItemClick}
      >
        <Sparkles className="size-4" />
        <span>{t('upgrade')}</span>
      </button>

      <div className="h-px bg-border my-1" />

      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground transition-colors"
        onClick={onItemClick}
      >
        <BadgeCheck className="size-4 text-muted-foreground" />
        <span>{t('account')}</span>
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground transition-colors"
        onClick={onItemClick}
      >
        <CreditCard className="size-4 text-muted-foreground" />
        <span>{t('billing')}</span>
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground transition-colors"
        onClick={onItemClick}
      >
        <Bell className="size-4 text-muted-foreground" />
        <span>{t('notifications')}</span>
      </button>

      <div className="h-px bg-border my-1" />

      <button
        type="button"
        onClick={() => {
          changeLanguage('pl');
          onItemClick?.();
        }}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <Globe className="size-4 text-muted-foreground" />
        <span>Polski</span>
        {locale === 'pl' && <Check className="ml-auto size-4" />}
      </button>
      <button
        type="button"
        onClick={() => {
          changeLanguage('en');
          onItemClick?.();
        }}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <Globe className="size-4 text-muted-foreground" />
        <span>English</span>
        {locale === 'en' && <Check className="ml-auto size-4" />}
      </button>

      <div className="h-px bg-border my-1" />

      <button
        type="button"
        onClick={() => {
          const isDark = document.documentElement.classList.contains('dark');
          setTheme(isDark ? 'light' : 'dark');
          onItemClick?.();
        }}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground transition-colors relative"
      >
        <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute left-2 size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span className="ml-6">{t('theme')}</span>
      </button>

      <div className="h-px bg-border my-1" />

      <button
        type="button"
        onClick={() => {
          handleLogout();
          onItemClick?.();
        }}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none text-destructive hover:bg-destructive/10 hover:text-destructive transition-colors"
      >
        <LogOut className="size-4" />
        <span>{t('logout')}</span>
      </button>
    </>
  );
}
