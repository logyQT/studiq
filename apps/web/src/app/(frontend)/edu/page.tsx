'use client';

import type {
  ProblematicQuestionStats,
  TeacherFeedItem,
  TeacherGroupPerformance,
} from '@studiq/server/models/stats.model';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@studiq/ui';
import { ArrowRight, ClipboardCheck, FileText, Layers, Plus, Users, Zap } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ActivityFeedCard } from '@/components/edu/dashboard/activity-feed-card';
import { GroupPerformanceCard } from '@/components/edu/dashboard/group-performance-card';
import { ProblemQuestionsCard } from '@/components/edu/dashboard/problem-questions-card';
import { OnboardingChecklist } from '@/components/edu/onboarding-checklist';
import { useApiQuery } from '@/hooks/use-api';
import { useOrgs } from '@/hooks/use-orgs';

interface TeacherStats {
  totalQuestions: number;
  totalFlashcards: number;
  subject?: { problematicQuestions?: ProblematicQuestionStats[] };
}

/** Window of the per-group results and of the attempts counted in the stat cards. */
const RESULT_DAYS = 30;
/** A dashboard is looked at again and again: refetch after a minute, not never. */
const STALE_MS = 60_000;

export default function EduOverviewPage() {
  const t = useTranslations('EduOverviewPage');
  const { activeOrg, isPending: orgsPending } = useOrgs();

  // The active organization is part of every key: switching it must not show the other
  // organization's numbers while the new ones load.
  const orgId = activeOrg?.id ?? null;

  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useApiQuery<TeacherStats>({
    queryKey: ['stats', 'teacher', 'overview', orgId],
    url: '/api/v1/stats/teacher',
    staleTime: STALE_MS,
    enabled: !orgsPending,
  });
  const {
    data: groups,
    isLoading: groupsLoading,
    isError: groupsError,
    refetch: refetchGroups,
  } = useApiQuery<TeacherGroupPerformance>({
    queryKey: ['stats', 'teacher', 'groups', orgId, RESULT_DAYS],
    url: `/api/v1/stats/teacher/groups?days=${RESULT_DAYS}`,
    staleTime: STALE_MS,
    enabled: !orgsPending,
  });
  const {
    data: feed,
    isLoading: feedLoading,
    isError: feedError,
    refetch: refetchFeed,
  } = useApiQuery<TeacherFeedItem[]>({
    queryKey: ['stats', 'teacher', 'feed', orgId],
    url: '/api/v1/stats/teacher/feed?limit=10',
    staleTime: STALE_MS,
    enabled: !orgsPending,
  });

  const loading = statsLoading || orgsPending;
  // Distinct learners and attempts from the aggregate itself: a learner in two groups is one
  // learner, so the totals are never the sum of the group rows. A failed read shows a dash.
  const students = groups?.totals.students;
  const completed = groups?.totals.completedAttempts;

  return (
    <div className="space-y-8">
      <OnboardingChecklist />

      {/* Stat Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('total_questions')}
          value={loading ? '...' : (stats?.totalQuestions ?? 0)}
          icon={FileText}
          variant="blue"
        />
        <StatCard
          title={t('flashcards')}
          value={loading ? '...' : (stats?.totalFlashcards ?? 0)}
          icon={Layers}
          variant="violet"
        />
        <StatCard
          title={t('students_stat')}
          value={groupsLoading ? '...' : groupsError ? '—' : (students ?? 0)}
          icon={Users}
          variant="emerald"
        />
        <StatCard
          title={t('completed_stat', { days: RESULT_DAYS })}
          value={groupsLoading ? '...' : groupsError ? '—' : (completed ?? 0)}
          icon={ClipboardCheck}
          variant="amber"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <GroupPerformanceCard
            data={groups}
            isLoading={groupsLoading}
            isError={groupsError}
            onRetry={() => refetchGroups()}
            days={RESULT_DAYS}
          />
        </div>
        <ActivityFeedCard
          items={feed}
          isLoading={feedLoading}
          isError={feedError}
          onRetry={() => refetchFeed()}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <ProblemQuestionsCard
          questions={stats?.subject?.problematicQuestions}
          isLoading={statsLoading}
          isError={statsError}
          onRetry={() => refetchStats()}
        />

        {/* Quick Actions */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="rounded-lg bg-primary/10 p-1.5">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              {t('quick_actions')}
            </CardTitle>
            <CardDescription>{t('quick_actions_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pb-6">
            <Link href="/edu/questions" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/10 hover:border-blue-500/25 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-blue-500/15 p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('create_question')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('questions_card_desc')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-blue-500 group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>

            <Link href="/edu/flashcards" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-violet-500/5 hover:bg-violet-500/10 border border-violet-500/10 hover:border-violet-500/25 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-violet-500/15 p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <Plus className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('create_flashcard')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('flashcards_card_desc')}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-violet-500 group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
