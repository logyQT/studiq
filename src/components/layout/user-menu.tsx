'use client';

import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import { DicebearAvatar } from '@/components/ui/dicebear-avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { LogOut, Globe, Sun, Moon, Check } from 'lucide-react';
import { UserRole } from '@/types';
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

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SYS_ADMIN]: 'role_sys_admin',
  [UserRole.UNIVERSITY_ADMIN]: 'role_uni_admin',
  [UserRole.TEACHER]: 'role_teacher',
  [UserRole.STUDENT]: 'role_student',
  [UserRole.PREMIUM]: 'role_premium',
  [UserRole.FREE]: 'role_free',
};

interface UserMenuProps {
  className?: string;
}

export function UserMenu({ className }: UserMenuProps) {
  const { user } = useAuth();
  const t = useTranslations('DashboardLayout');
  const { setTheme } = useTheme();
  const locale = getLocale();

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || t('default_user');
  const userRole = user?.app_metadata?.role as UserRole | undefined;

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-9 w-9 rounded-full', className)}
        >
          <DicebearAvatar seed={user?.email || userName} size={36} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-3">
            <DicebearAvatar seed={user?.email || userName} size={40} />
            <div className="flex flex-col gap-0.5 min-w-0">
              <p className="text-sm font-medium leading-none truncate">{userName}</p>
              <p className="text-xs leading-none text-muted-foreground truncate">
                {user?.email}
              </p>
              {userRole && (
                <Badge variant="secondary" className="mt-1 w-fit text-[10px] px-1.5 py-0">
                  {t(ROLE_LABELS[userRole])}
                </Badge>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span>{t('language')}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {locale === 'pl' ? 'PL' : 'EN'}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => changeLanguage('pl')} className="gap-2">
              <span>🇵🇱</span>
              <span>Polski</span>
              {locale === 'pl' && <Check className="ml-auto h-4 w-4" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => changeLanguage('en')} className="gap-2">
              <span>🇬🇧</span>
              <span>English</span>
              {locale === 'en' && <Check className="ml-auto h-4 w-4" />}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem
          onClick={() => {
            const isDark = document.documentElement.classList.contains('dark');
            setTheme(isDark ? 'light' : 'dark');
          }}
          className="gap-2"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span>{t('theme')}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive gap-2">
          <LogOut className="h-4 w-4" />
          <span>{t('logout')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
