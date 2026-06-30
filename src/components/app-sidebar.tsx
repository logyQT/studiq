'use client';

import { usePathname } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar';
import { useFeature } from '@/hooks/use-feature';
import { OrgSwitcher } from '@/components/layout/org-switcher';
import { UserMenu } from '@/components/layout/user-menu';
import { NavMain, type NavItem } from '@/components/nav-main';
import {
  LayoutDashboard,
  FileText,
  Layers,
  BarChart3,
  Users,
  UserPlus,
  Mail,
  Settings,
  Brain,
  ListPlus,
  GraduationCap,
  Monitor,
  AlertTriangle,
  ShieldCheck,
  Sparkles,
  Folder,
  Tag,
} from 'lucide-react';

const NAV_ITEMS: Record<string, { label: string; items: NavItem[] }[]> = {
  '/edu': [
    {
      label: 'sidebar_main',
      items: [
        { titleKey: 'edu_overview', href: '/edu', icon: LayoutDashboard },
        { titleKey: 'ai_chat', href: '/edu/ai', icon: Sparkles },
      ],
    },
    {
      label: 'sidebar_classroom',
      items: [
        { titleKey: 'classroom_invite', href: '/edu/classroom/invite', icon: UserPlus },
        { titleKey: 'classroom_members', href: '/edu/classroom/members', icon: Users },
      ],
    },
    {
      label: 'sidebar_content',
      items: [
        { titleKey: 'flashcard_decks', href: '/edu/flashcards/decks', icon: Layers },
        { titleKey: 'flashcard_topics', href: '/edu/flashcards/topics', icon: Tag },
        { titleKey: 'edu_questions', href: '/edu/questions', icon: FileText },
      ],
    },
    {
      label: 'sidebar_statistics',
      items: [
        { titleKey: 'stats_overview', href: '/edu/stats', icon: BarChart3 },
        { titleKey: 'stats_flashcards', href: '/edu/flashcards/stats', icon: BarChart3 },
        { titleKey: 'stats_questions', href: '/edu/statistics', icon: BarChart3 },
        { titleKey: 'stats_quizzes', href: '/edu/stats/quizzes', icon: BarChart3 },
        { titleKey: 'stats_activity', href: '/edu/stats/activity', icon: BarChart3 },
      ],
    },
  ],
  '/manage': [
    {
      label: 'sidebar_main',
      items: [
        { titleKey: 'manage_overview', href: '/manage', icon: LayoutDashboard },
        { titleKey: 'ai_chat', href: '/manage/ai', icon: Sparkles },
      ],
    },
    {
      label: 'sidebar_administration',
      items: [
        { titleKey: 'manage_members', href: '/manage/members', icon: Users },
        { titleKey: 'manage_invitations', href: '/manage/invitations', icon: Mail },
        { titleKey: 'manage_settings', href: '/manage/settings', icon: Settings },
      ],
    },
  ],
  '/app': [
    {
      label: 'sidebar_main',
      items: [
        { titleKey: 'app_overview', href: '/app', icon: LayoutDashboard },
        { titleKey: 'flashcard_study', href: '/app/study', icon: Brain },
        { titleKey: 'ai_chat', href: '/app/ai', icon: Sparkles, feature: 'ai.chat' },
      ],
    },
    {
      label: 'sidebar_content',
      items: [
        { titleKey: 'flashcard_decks', href: '/app/flashcards/decks', icon: Folder },
        { titleKey: 'flashcard_topics', href: '/app/flashcards/topics', icon: Tag },
        { titleKey: 'app_my_questions', href: '/app/my-questions', icon: ListPlus },
      ],
    },
    {
      label: 'sidebar_statistics',
      items: [{ titleKey: 'app_stats', href: '/app/stats', icon: BarChart3 }],
    },
  ],
  '/admin': [
    {
      label: 'sidebar_main',
      items: [
        { titleKey: 'admin_overview', href: '/admin', icon: LayoutDashboard },
        { titleKey: 'ai_chat', href: '/admin/ai', icon: Sparkles },
      ],
    },
    {
      label: 'sidebar_system',
      items: [
        { titleKey: 'admin_universities', href: '/admin', icon: GraduationCap },
        { titleKey: 'admin_error_logs', href: '/admin/logs', icon: AlertTriangle },
        { titleKey: 'admin_permissions', href: '/admin/permissions', icon: ShieldCheck },
        { titleKey: 'admin_system', href: '/admin', icon: Monitor },
      ],
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { hasAccess: hasAiChat } = useFeature('ai.chat');

  const groups = (() => {
    const raw = (() => {
      if (pathname.startsWith('/edu')) return NAV_ITEMS['/edu'];
      if (pathname.startsWith('/manage')) return NAV_ITEMS['/manage'];
      if (pathname.startsWith('/app')) return NAV_ITEMS['/app'];
      if (pathname.startsWith('/admin')) return NAV_ITEMS['/admin'];
      return [];
    })();

    return raw.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!item.feature) return true;
        if (item.feature === 'ai.chat') return hasAiChat;
        return true;
      }),
    }));
  })();

  const activeHref = (() => {
    let best: string | null = null;
    for (const group of groups) {
      for (const item of group.items) {
        const matches =
          pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'));
        if (matches && (!best || item.href.length > best.length)) {
          best = item.href;
        }
      }
    }
    return best;
  })();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <OrgSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <NavMain
            key={group.label}
            items={group.items}
            label={group.label}
            activeHref={activeHref}
          />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
