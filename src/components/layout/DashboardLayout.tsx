'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarSeparator,
  SidebarInset,
} from '@/components/ui/sidebar';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { UserMenu } from '@/components/layout/user-menu';
import { AppSearch } from '@/components/layout/app-search';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { useBreadcrumbs } from '@/hooks/use-breadcrumbs';
import { cn } from '@/lib/utils';
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
    { titleKey: 'edu_ai_chat', href: '/app/ai', icon: Sparkles },
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
    { titleKey: 'app_ai_chat', href: '/app/flashcards/ai', icon: Sparkles },
    { titleKey: 'app_flashcards', href: '/app/flashcards', icon: Brain },
    { titleKey: 'app_quiz', href: '/app/quiz', icon: BookOpen },
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
      pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'));
    if (matches && (!best || item.href.length > best.href.length)) {
      best = item;
    }
  }
  return best?.href ?? null;
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations('DashboardLayout');
  const navItems = getNavGroup(pathname);
  const activeHref = getActiveHref(pathname, navItems);

  const showSearch = pathname.startsWith('/app') || pathname.startsWith('/edu');
  const crumbs = useBreadcrumbs(pathname);

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
      </Sidebar>

      <SidebarInset className="overflow-y-auto max-h-svh">
        {/* Topbar */}
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm">
          <div className="flex h-14 items-center gap-4 px-6 border-b border-border/60">
            <SidebarTrigger className="hover:bg-primary/8 hover:text-primary transition-colors" />
            {showSearch && (
              <div className="flex-1 flex justify-center min-w-0">
                <AppSearch />
              </div>
            )}
            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
              <LanguageToggle />
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
          {crumbs.length > 0 && (
            <div className="px-6 py-2">
              <Breadcrumbs items={crumbs} />
            </div>
          )}
        </header>

        {/* Main content */}
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
