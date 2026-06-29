'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { UserMenu } from '@/components/layout/user-menu';
import { AppSearch } from '@/components/layout/app-search';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  FileText,
  Layers,
  BarChart3,
  Users,
  Mail,
  Settings,
  Brain,
  ListPlus,
  GraduationCap,
  Monitor,
  AlertTriangle,
  ShieldCheck,
  Sparkles,
  ChevronDown,
  Folder,
  Tag,
} from 'lucide-react';

export type NavItem = {
  titleKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: { titleKey: string; href: string }[];
};

const NAV_ITEMS: Record<string, NavItem[]> = {
  '/edu': [
    { titleKey: 'edu_overview', href: '/edu', icon: LayoutDashboard },
    { titleKey: 'ai_chat', href: '/edu/ai', icon: Sparkles },
    {
      titleKey: 'edu_flashcards',
      href: '/edu/flashcards',
      icon: Layers,
      children: [
        { titleKey: 'flashcard_decks', href: '/edu/flashcards/decks' },
        { titleKey: 'flashcard_stats', href: '/edu/flashcards/stats' },
        { titleKey: 'flashcard_topics', href: '/edu/flashcards/topics' },
      ],
    },
    { titleKey: 'edu_questions', href: '/edu/questions', icon: FileText },
    { titleKey: 'edu_statistics', href: '/edu/statistics', icon: BarChart3 },
  ],
  '/manage': [
    { titleKey: 'manage_overview', href: '/manage', icon: LayoutDashboard },
    { titleKey: 'ai_chat', href: '/manage/ai', icon: Sparkles },
    { titleKey: 'manage_members', href: '/manage/members', icon: Users },
    { titleKey: 'manage_invitations', href: '/manage/invitations', icon: Mail },
    { titleKey: 'manage_settings', href: '/manage/settings', icon: Settings },
  ],
  '/app': [
    { titleKey: 'app_overview', href: '/app', icon: LayoutDashboard },
    { titleKey: 'flashcard_study', href: '/app/study', icon: Brain },
    { titleKey: 'flashcard_decks', href: '/app/flashcards/decks', icon: Folder },
    { titleKey: 'flashcard_topics', href: '/app/flashcards/topics', icon: Tag },
    { titleKey: 'app_my_questions', href: '/app/my-questions', icon: ListPlus },
    { titleKey: 'app_stats', href: '/app/stats', icon: BarChart3 },
    { titleKey: 'ai_chat', href: '/app/ai', icon: Sparkles },
  ],
  '/admin': [
    { titleKey: 'admin_overview', href: '/admin', icon: LayoutDashboard },
    { titleKey: 'ai_chat', href: '/admin/ai', icon: Sparkles },
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

function SidebarLogo() {
  const { toggleSidebar } = useSidebar();

  return (
    <SidebarHeader>
      <div className="flex items-center">
        <button
          onClick={toggleSidebar}
          className="flex items-center w-full py-1.5 rounded-lg group-data-[collapsible=icon]:flex hidden"
          aria-label="Expand sidebar"
        >
          <div className="rounded-xl bg-primary p-1.5 shadow-sm shrink-0">
            <GraduationCap className="size-5 text-primary-foreground" />
          </div>
        </button>

        <div className="flex items-center gap-2.5 py-1.5 w-full group-data-[collapsible=icon]:hidden">
          <div className="rounded-xl bg-primary p-1.5 shadow-sm shrink-0">
            <GraduationCap className="size-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold tracking-tight truncate">
            Studi<span className="text-primary">Q</span>
          </span>
          <SidebarTrigger className="ml-auto" />
        </div>
      </div>
    </SidebarHeader>
  );
}

function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useSidebar();
  const t = useTranslations('DashboardLayout');
  const navItems = getNavGroup(pathname);

  const longestMatchHref = (() => {
    let best: string | null = null;
    for (const item of navItems) {
      const matches =
        pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'));
      if (matches && (!best || item.href.length > best.length)) {
        best = item.href;
      }
    }
    return best;
  })();

  return (
    <SidebarMenu className="gap-0.5">
      {navItems.map((item) => {
        if (item.children) {
          const isParentActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Collapsible
              key={item.titleKey}
              defaultOpen={pathname.startsWith(item.href)}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    isActive={isParentActive}
                    tooltip={t(item.titleKey)}
                    onClick={() => {
                      if (state === 'collapsed' && item.children?.[0]) {
                        router.push(item.children[0].href);
                      }
                    }}
                    className={cn(
                      'h-8 rounded-lg transition-all duration-150',
                      isParentActive
                        ? 'bg-primary/10 text-primary font-medium hover:bg-primary/15 data-[active=true]:bg-primary/10 data-[active=true]:text-primary'
                        : 'text-sidebar-foreground/80 hover:bg-primary/8 hover:text-primary',
                    )}
                  >
                    <item.icon
                      className={cn(
                        'h-4 w-4 shrink-0 transition-colors',
                        isParentActive ? 'text-primary' : 'text-sidebar-foreground/60',
                      )}
                    />
                    <span>{t(item.titleKey)}</span>
                    <ChevronDown className="ml-auto h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.children.map((child) => {
                      const isChildActive =
                        pathname === child.href || pathname.startsWith(child.href + '/');
                      return (
                        <SidebarMenuSubItem key={child.titleKey}>
                          <SidebarMenuSubButton asChild isActive={isChildActive}>
                            <Link href={child.href}>
                              <span>{t(child.titleKey)}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          );
        }

        const isActive = item.href === longestMatchHref;
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
                'h-8 rounded-lg transition-all duration-150',
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
  );
}

export function DashboardLayout({
  children,
  fullWidth = false,
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <SidebarProvider defaultOpen={false} className="flex-col !h-svh">
      <div className="flex flex-1 min-h-0">
        <Sidebar collapsible="icon" className="!relative !inset-auto !h-full">
          <SidebarLogo />
          <SidebarContent className="py-3 px-2">
            <SidebarNav />
          </SidebarContent>
          <SidebarFooter className="group-data-[collapsible=icon]:p-0">
            <UserMenu compact />
          </SidebarFooter>
        </Sidebar>

        <div className="flex-1 flex flex-col min-w-0">
          <main
            className={cn(
              'flex-1 min-h-0 overflow-y-auto scrollbar-gutter-stable',
              fullWidth ? 'flex flex-col' : 'p-content',
            )}
          >
            {children}
          </main>
        </div>
      </div>
      <AppSearch />
    </SidebarProvider>
  );
}
