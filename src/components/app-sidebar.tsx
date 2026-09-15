'use client';

import { AccountType } from '@studiq/authz';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@studiq/ui';
import {
  BarChart3,
  Brain,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Database,
  Dumbbell,
  Flag,
  Folder,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Mail,
  MessageSquareWarning,
  PieChart,
  Radio,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  TrendingUp,
  UserCog,
  Users,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { OrgSwitcher } from '@/components/layout/org-switcher';
import { UserMenu } from '@/components/layout/user-menu';
import { type NavItem, NavMain } from '@/components/nav-main';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { useFeature } from '@/hooks/use-feature';
import { questionReportKeys } from '@/lib/query-keys';

const NAV_ITEMS: Record<string, { label: string; items: NavItem[] }[]> = {
  '/edu': [
    {
      label: 'sidebar_main',
      items: [
        { titleKey: 'edu_overview', href: '/edu', icon: LayoutDashboard },
        { titleKey: 'ai_chat', href: '/edu/ai', icon: Sparkles },
      ],
    },
    // UI_HIDDEN: classroom section — stale for org-managed flow
    // {
    //   label: 'sidebar_classroom',
    //   items: [
    //     { titleKey: 'classroom_invite', href: '/edu/classroom/invite', icon: UserPlus },
    //     { titleKey: 'classroom_members', href: '/edu/classroom/members', icon: Users },
    //   ],
    // },
    {
      label: 'sidebar_content',
      items: [
        { titleKey: 'flashcard_decks', href: '/edu/flashcards', icon: Layers },
        { titleKey: 'flashcard_topics', href: '/edu/topics', icon: Tag },
        { titleKey: 'question_banks', href: '/edu/questions', icon: Database },
        { titleKey: 'edu_quizzes', href: '/edu/quizzes', icon: ScrollText },
        { titleKey: 'edu_assignments', href: '/edu/assignments', icon: ClipboardCheck },
        { titleKey: 'question_reports', href: '/edu/reports', icon: MessageSquareWarning },
        { titleKey: 'edu_groups', href: '/edu/groups', icon: Users, feature: 'group.manage' },
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
        { titleKey: 'manage_invitations', href: '/manage/invites', icon: Mail },
        { titleKey: 'manage_groups', href: '/manage/groups', icon: Layers },
        { titleKey: 'manage_roles', href: '/manage/roles', icon: ShieldCheck },
        { titleKey: 'manage_seats', href: '/manage/seats', icon: CreditCard },
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
        { titleKey: 'flashcard_decks', href: '/app/flashcards', icon: Folder },
        { titleKey: 'flashcard_topics', href: '/app/topics', icon: Tag },
        { titleKey: 'question_banks', href: '/app/questions', icon: Database },
        { titleKey: 'app_assignments', href: '/app/assignments', icon: ClipboardCheck },
        { titleKey: 'question_reports', href: '/app/reports', icon: MessageSquareWarning },
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
      items: [{ titleKey: 'admin_overview', href: '/admin', icon: LayoutDashboard }],
    },
    {
      label: 'sidebar_system',
      items: [
        { titleKey: 'admin_orgs', href: '/admin/orgs', icon: GraduationCap },
        { titleKey: 'admin_feature_flags', href: '/admin/feature-flags', icon: Flag },
        {
          titleKey: 'admin_subscription_plans',
          href: '/admin/subscription-plans',
          icon: CreditCard,
        },
        { titleKey: 'admin_user_overrides', href: '/admin/user-overrides', icon: UserCog },
      ],
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { user } = useAuth();
  const accountType = user?.app_metadata?.account_type as AccountType | undefined;
  const isSysAdmin = accountType === AccountType.SYS_ADMIN;
  const feature = useFeature();

  const { data: reportsUnread } = useApiQuery<{ count: number }>({
    queryKey: questionReportKeys.unreadCount,
    url: '/api/v1/question-reports/unread-count',
    enabled: !!user,
    staleTime: 30 * 1000,
  });

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
      items: group.items
        .filter((item) => !item.feature || feature(item.feature))
        .map((item) =>
          item.href.endsWith('/reports') ? { ...item, badge: reportsUnread?.count ?? 0 } : item,
        ),
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
      <SidebarHeader>{!isSysAdmin && <OrgSwitcher />}</SidebarHeader>
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
