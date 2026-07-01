'use client';

import {
  AlertTriangle,
  BarChart3,
  Brain,
  ClipboardList,
  Dumbbell,
  FileText,
  Folder,
  GraduationCap,
  Layers,
  LayoutDashboard,
  ListPlus,
  Mail,
  Monitor,
  PieChart,
  Radio,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { OrgSwitcher } from '@/components/layout/org-switcher';
import { UserMenu } from '@/components/layout/user-menu';
import { type NavItem, NavMain } from '@/components/nav-main';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar';
import { useFeature } from '@/hooks/use-feature';

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
        { titleKey: 'stats_data', href: '/edu/stats/data', icon: PieChart },
        { titleKey: 'stats_results', href: '/edu/stats/results', icon: BarChart3 },
        { titleKey: 'stats_activity', href: '/edu/stats/activity', icon: TrendingUp },
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
        { titleKey: 'ai_chat', href: '/app/ai', icon: Sparkles, feature: 'ai.chat' },
      ],
    },
    {
      label: 'sidebar_study',
      items: [
        { titleKey: 'app_learn', href: '/app/study/learn', icon: Brain },
        { titleKey: 'app_cram', href: '/app/study/cram', icon: Dumbbell },
        { titleKey: 'app_quiz', href: '/app/study/quiz', icon: ClipboardList },
        { titleKey: 'app_live', href: '/app/study/live', icon: Radio },
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
      items: [
        { titleKey: 'stats_data', href: '/app/stats/content', icon: PieChart },
        { titleKey: 'stats_results', href: '/app/stats/results', icon: BarChart3 },
        { titleKey: 'stats_activity', href: '/app/stats/activity', icon: TrendingUp },
      ],
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
          pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
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
