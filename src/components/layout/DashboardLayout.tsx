'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarSeparator,
  SidebarInset,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { AppSearch } from '@/components/layout/app-search';
import { cn } from '@/lib/utils';
import { UserRole } from '@/types';
import {
  LayoutDashboard,
  FileText,
  Layers,
  BarChart3,
  Users,
  Mail,
  Settings,
  BookOpen,
  Brain,
  ListPlus,
  TrendingUp,
  GraduationCap,
  LogOut,
  Monitor,
  Tags,
  AlertTriangle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export type NavItem = {
  titleKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV_ITEMS: Record<string, NavItem[]> = {
  '/edu': [
    { titleKey: 'edu_overview', href: '/edu', icon: LayoutDashboard },
    { titleKey: 'edu_questions', href: '/edu/questions', icon: FileText },
    { titleKey: 'edu_flashcards', href: '/edu/flashcards', icon: Layers },
    { titleKey: 'edu_flashcard_topics', href: '/edu/flashcards/topics', icon: Tags },
    { titleKey: 'edu_statistics', href: '/edu/statistics', icon: BarChart3 },
  ],
  '/manage': [
    { titleKey: 'manage_overview', href: '/manage', icon: LayoutDashboard },
    { titleKey: 'manage_members', href: '/manage/members', icon: Users },
    { titleKey: 'manage_invitations', href: '/manage/invitations', icon: Mail },
    { titleKey: 'manage_settings', href: '/manage/settings', icon: Settings },
  ],
  '/app': [
    { titleKey: 'app_overview', href: '/app', icon: LayoutDashboard },
    { titleKey: 'app_quiz', href: '/app/quiz', icon: BookOpen },
    { titleKey: 'app_flashcards', href: '/app/flashcards', icon: Brain },
    { titleKey: 'app_ai_generate', href: '/app/flashcards/ai', icon: Sparkles },
    { titleKey: 'app_my_questions', href: '/app/my-questions', icon: ListPlus },
    { titleKey: 'app_statistics', href: '/app/statistics', icon: TrendingUp },
  ],
  '/admin': [
    { titleKey: 'admin_overview', href: '/admin', icon: LayoutDashboard },
    { titleKey: 'admin_universities', href: '/admin', icon: GraduationCap },
    { titleKey: 'admin_error_logs', href: '/admin/logs', icon: AlertTriangle },
    { titleKey: 'admin_permissions', href: '/admin/permissions', icon: ShieldCheck },
    { titleKey: 'admin_system', href: '/admin', icon: Monitor },
  ],
};

const DASHBOARD_TITLE_KEYS: Record<string, string> = {
  '/edu': 'teacher_dashboard',
  '/manage': 'university_dashboard',
  '/app': 'student_dashboard',
  '/admin': 'sys_admin_dashboard',
};

const ROLE_BADGE_STYLES: Record<UserRole, string> = {
  [UserRole.SYS_ADMIN]: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  [UserRole.UNIVERSITY_ADMIN]: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  [UserRole.TEACHER]: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  [UserRole.STUDENT]: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  [UserRole.PREMIUM]: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  [UserRole.FREE]: 'bg-muted text-muted-foreground border-border',
};

function getNavGroup(pathname: string): NavItem[] {
  if (pathname.startsWith('/edu')) return NAV_ITEMS['/edu'];
  if (pathname.startsWith('/manage')) return NAV_ITEMS['/manage'];
  if (pathname.startsWith('/app')) return NAV_ITEMS['/app'];
  if (pathname.startsWith('/admin')) return NAV_ITEMS['/admin'];
  return [];
}

function getActiveHref(pathname: string, navItems: NavItem[]): string | null {
  let best: NavItem | null = null;
  for (const item of navItems) {
    const matches =
      pathname === item.href ||
      (item.href !== '/' && pathname.startsWith(item.href + '/'));
    if (matches && (!best || item.href.length > best.href.length)) {
      best = item;
    }
  }
  return best?.href ?? null;
}

function getDashboardTitleKey(pathname: string): string {
  for (const [prefix, key] of Object.entries(DASHBOARD_TITLE_KEYS)) {
    if (pathname.startsWith(prefix)) return key;
  }
  return 'teacher_dashboard';
}

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

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const t = useTranslations('DashboardLayout');
  const navItems = getNavGroup(pathname);
  const activeHref = getActiveHref(pathname, navItems);
  const dashboardTitleKey = getDashboardTitleKey(pathname);

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || t('default_user');
  const userRole = user?.app_metadata?.role as UserRole | undefined;
  const showSearch = pathname.startsWith('/app') || pathname.startsWith('/edu');

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/v1/auth/logout', { method: 'POST' });
      if (!res.ok) throw new Error('Logout failed');
      window.location.href = '/login';
    } catch {
      window.location.href = '/login';
    }
  };

  return (
    <SidebarProvider>
      <Sidebar>
        {/* Logo */}
        <SidebarHeader className="px-4 py-5">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="rounded-xl bg-primary p-1.5 shrink-0 shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all duration-200">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold tracking-tight">
              Studi<span className="text-primary">Q</span>
            </span>
          </Link>
          {userRole && (
            <span
              className={cn(
                'mt-0.5 inline-flex w-fit items-center px-2 py-0.5 rounded-full text-xs font-medium border',
                ROLE_BADGE_STYLES[userRole],
              )}
            >
              {getRoleLabel(userRole, t)}
            </span>
          )}
        </SidebarHeader>

        <SidebarSeparator />

        {/* Navigation */}
        <SidebarContent className="py-3 px-2">
          <SidebarMenu className="gap-0.5">
            {navItems.map((item) => {
              const isActive = item.href === activeHref;
              return (
                <SidebarMenuItem key={item.titleKey} className="relative">
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full z-10" />
                  )}
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={t(item.titleKey)}
                    className={cn(
                      'h-10 px-4 rounded-lg transition-all duration-150',
                      isActive
                        ? 'bg-primary/10 text-primary font-medium hover:bg-primary/15 data-[active=true]:bg-primary/10 data-[active=true]:text-primary'
                        : 'text-sidebar-foreground/80 hover:bg-primary/8 hover:text-primary',
                    )}
                  >
                    <Link href={item.href}>
                      <item.icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          isActive ? 'text-primary' : 'text-sidebar-foreground/60',
                        )}
                      />
                      <span>{t(item.titleKey)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarContent>

        <SidebarSeparator />

        {/* User footer */}
        <SidebarFooter className="px-3 py-4">
          <div className="flex items-center gap-3 min-w-0 px-2 mb-1">
            <Avatar className="h-8 w-8 shrink-0 ring-2 ring-primary/20">
              <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                {getInitials(userName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">{userName}</p>
              <p className="truncate text-xs text-muted-foreground leading-tight">{user?.email}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="w-full justify-start h-9 px-3 text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/8 transition-colors"
          >
            <LogOut className="h-4 w-4 mr-2" />
            <span>{t('logout')}</span>
          </Button>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="overflow-y-auto max-h-svh">
        {/* Topbar */}
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm">
          <div className="flex h-14 items-center gap-4 px-6">
            <div className="flex items-center gap-3 shrink-0">
              <SidebarTrigger className="hover:bg-primary/8 hover:text-primary transition-colors" />
              <h1 className="text-base font-semibold text-foreground max-md:hidden">
                {t(dashboardTitleKey)}
              </h1>
            </div>
            {showSearch && (
              <div className="flex-1 flex justify-center min-w-0">
                <AppSearch />
              </div>
            )}
            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
