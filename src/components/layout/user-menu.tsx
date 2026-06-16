'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
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
import { LogOut } from 'lucide-react';
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
        <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive cursor-pointer">
          <LogOut className="mr-2 h-4 w-4" />
          <span>{t('logout')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
