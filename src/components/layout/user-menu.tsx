'use client';

import { useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import { useIsMobile } from '@/hooks/use-mobile';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, Globe, Sun, Moon } from 'lucide-react';
import { UserRole } from '@/types';
import { cn } from '@/lib/utils';

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const getRoleLabel = (role: UserRole, t: (key: string) => string): string => {
  const map: Record<UserRole, string> = {
    [UserRole.SYS_ADMIN]: t('role_sys_admin'),
    [UserRole.UNIVERSITY_ADMIN]: t('role_uni_admin'),
    [UserRole.TEACHER]: t('role_teacher'),
    [UserRole.STUDENT]: t('role_student'),
    [UserRole.PREMIUM]: t('role_premium'),
    [UserRole.FREE]: t('role_free'),
  };
  return map[role];
};

interface UserMenuProps {
  className?: string;
}

export function UserMenu({ className }: UserMenuProps) {
  const { user } = useAuth();
  const t = useTranslations('DashboardLayout');
  const isMobile = useIsMobile();
  const { setTheme } = useTheme();
  const [locale, setLocale] = useState<'pl' | 'en'>(() => {
    if (typeof document === 'undefined') return 'pl';
    const match = document.cookie.match(/NEXT_LOCALE=(pl|en)/);
    return (match?.[1] as 'pl' | 'en') || 'pl';
  });

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

  function changeLanguage(lang: 'pl' | 'en') {
    document.cookie = `NEXT_LOCALE=${lang}; path=/; max-age=31536000`;
    setLocale(lang);
    window.location.reload();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8 rounded-full', className)}
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
              {getInitials(userName)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium leading-none">{userName}</p>
            <p className="text-xs leading-none text-muted-foreground truncate">
              {user?.email}
            </p>
            {userRole && (
              <p className="text-xs leading-none text-muted-foreground pt-1">
                {getRoleLabel(userRole, t)}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {isMobile && (
          <>
            <DropdownMenuItem onClick={() => changeLanguage(locale === 'pl' ? 'en' : 'pl')} className="cursor-pointer">
              <Globe className="mr-2 h-4 w-4" />
              <span>{locale === 'pl' ? '🇬🇧 English' : '🇵🇱 Polski'}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const isDark = document.documentElement.classList.contains('dark');
                setTheme(isDark ? 'light' : 'dark');
              }}
              className="cursor-pointer"
            >
              <Sun className="mr-2 h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute mr-2 h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span>{t('theme_toggle')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive cursor-pointer">
          <LogOut className="mr-2 h-4 w-4" />
          <span>{t('logout')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
