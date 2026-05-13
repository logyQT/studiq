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
    { titleKey: 'app_my_questions', href: '/app/my-questions', icon: ListPlus },
    { titleKey: 'app_statistics', href: '/app/statistics', icon: TrendingUp },
  ],
  '/admin': [
    { titleKey: 'admin_overview', href: '/admin', icon: LayoutDashboard },
    { titleKey: 'admin_universities', href: '/admin', icon: GraduationCap },
    { titleKey: 'admin_system', href: '/admin', icon: Monitor },
  ],
};

const DASHBOARD_TITLE_KEYS: Record<string, string> = {
  '/edu': 'teacher_dashboard',
  '/manage': 'university_dashboard',
  '/app': 'student_dashboard',
  '/admin': 'sys_admin_dashboard',
};

function getNavGroup(pathname: string): NavItem[] {
  if (pathname.startsWith('/edu')) return NAV_ITEMS['/edu'];
  if (pathname.startsWith('/manage')) return NAV_ITEMS['/manage'];
  if (pathname.startsWith('/app')) return NAV_ITEMS['/app'];
  if (pathname.startsWith('/admin')) return NAV_ITEMS['/admin'];
  return [];
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

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SYS_ADMIN]: 'Sys Admin',
  [UserRole.UNIVERSITY_ADMIN]: 'Uni Admin',
  [UserRole.TEACHER]: 'Teacher',
  [UserRole.STUDENT]: 'Student',
  [UserRole.PREMIUM]: 'Premium',
  [UserRole.FREE]: 'Free',
};

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const t = useTranslations('DashboardLayout');
  const navItems = getNavGroup(pathname);
  const dashboardTitleKey = getDashboardTitleKey(pathname);

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'User';
  const userRole = user?.app_metadata?.role as UserRole | undefined;

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
        <SidebarHeader className="px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold tracking-tight">StudiQ</span>
          </Link>
          {userRole && (
            <span className="text-xs text-muted-foreground">{ROLE_LABELS[userRole]}</span>
          )}
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent className="py-2">
          <SidebarMenu className="gap-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href + '/'));
              return (
                <SidebarMenuItem key={item.titleKey}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={t(item.titleKey)}
                    className="h-10 px-4"
                  >
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{t(item.titleKey)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter className="px-4 py-4">
          <div className="flex items-center gap-3 min-w-0 mb-2">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-xs">{getInitials(userName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{userName}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="w-full justify-start h-9 px-3 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4 mr-2" />
            <span>{t('logout')}</span>
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-14 items-center gap-4 px-6">
            <SidebarTrigger />
            <div className="flex-1">
              <h1 className="text-lg font-semibold">{t(dashboardTitleKey)}</h1>
            </div>
            <div className="flex items-center gap-2">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="flex-1 p-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
