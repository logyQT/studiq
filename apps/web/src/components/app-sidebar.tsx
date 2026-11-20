'use client';

import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@studiq/ui';
import {
  BarChart3,
  Brain,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Database,
  Dumbbell,
  Folder,
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
  Users,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { OrgSwitcher } from '@/components/layout/org-switcher';
import { UserMenu } from '@/components/layout/user-menu';
import { NavMain } from '@/components/nav-main';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { useFeature } from '@/hooks/use-feature';
import { usePermission } from '@/hooks/use-permission';
import { questionReportKeys } from '@/lib/query-keys';
import { type SidebarSection, sectionsWithBadge, visibleNavItems } from '@/lib/sidebar-nav';

type DashboardArea = '/edu' | '/manage' | '/app';

const NAV_ITEMS: Record<DashboardArea, SidebarSection[]> = {
  '/edu': [
    {
      label: 'sidebar_main',
      items: [
        { titleKey: 'edu_overview', href: '/edu', icon: LayoutDashboard },
        { titleKey: 'ai_chat', href: '/edu/ai', icon: Sparkles, feature: 'ai.chat' },
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
        { titleKey: 'edu_groups', href: '/edu/groups', icon: Users, permission: 'group.read' },
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
      items: [{ titleKey: 'manage_overview', href: '/manage', icon: LayoutDashboard }],
    },
    {
      label: 'sidebar_administration',
      items: [
        { titleKey: 'manage_members', href: '/manage/members', icon: Users },
        { titleKey: 'manage_invitations', href: '/manage/invites', icon: Mail },
        { titleKey: 'manage_groups', href: '/manage/groups', icon: Layers },
        { titleKey: 'question_reports', href: '/manage/reports', icon: MessageSquareWarning },
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
        { titleKey: 'app_flashcard_decks', href: '/app/flashcards', icon: Folder },
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
};

const DASHBOARD_AREAS: readonly DashboardArea[] = ['/edu', '/manage', '/app'];

/** The sections of the dashboard area the path belongs to; anything else has none. */
export function currentSections(pathname: string): SidebarSection[] {
  const area = DASHBOARD_AREAS.find(
    (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
  return area ? NAV_ITEMS[area] : [];
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { user } = useAuth();
  const feature = useFeature();
  const permission = usePermission();

  const { data: reportsUnread } = useApiQuery<{ count: number }>({
    queryKey: questionReportKeys.unreadCount,
    url: '/api/v1/question-reports/unread-count',
    enabled: !!user,
    staleTime: 30 * 1000,
  });

  const gates = { feature, permission };
  const groups = sectionsWithBadge(
    currentSections(pathname),
    (section) => visibleNavItems(section.items, gates),
    reportsUnread?.count,
  );

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
