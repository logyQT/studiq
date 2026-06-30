'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { Brain, Target, FileText, TrendingUp, ArrowRight, Plus, RotateCcw, Layers, Zap, BookOpen, Lock } from 'lucide-react';
import { useAuth } from '@/components/providers';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/hooks/use-api';
import { OnboardingChecklist } from '@/components/app/onboarding-checklist';
import { useFeature } from '@/hooks/use-feature';

interface StudentStats {
  totalQuizzes: number;
  avgScore: number;
  totalQuestionsCreated: number;
  flashcardsPracticed: number;
  flashcardAccuracy: number;
  totalDecks: number;
  totalFlashcards: number;
  dueToday: number;
}

export default function AppOverviewPage() {
  const t = useTranslations('AppOverviewPage');
  const locale = useLocale();
  const router = useRouter();
  const { user } = useAuth();
  const { hasAccess } = useFeature('study.create');

  const { data: stats, isLoading } = useApiQuery<StudentStats>({
    queryKey: ['stats', 'student'],
    url: '/api/v1/stats/student',
  });

  const todayStr = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(new Date()),
    [locale],
  );

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Alex';

  return (
    <div className="space-y-8">
      <OnboardingChecklist />

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          {todayStr}
        </p>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {t('hello_greeting', { name: userName })}
            </h1>
            {stats && (
              <p className="text-sm text-muted-foreground mt-1">
                {t.rich('due_today', {
                  count: stats.dueToday,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="default" size="sm" onClick={() => router.push('/app/study')}>
              <RotateCcw className="w-4 h-4 mr-1.5" />
              {t('continue_reviewing')}
            </Button>
            <Button variant="outline" size="sm" disabled={!hasAccess} onClick={hasAccess ? () => router.push('/app/flashcards/decks') : () => router.push('/checkout?plan_id=student_premium')}>
              {hasAccess ? (
                <><Plus className="w-4 h-4 mr-1.5" /> {t('create_deck')}</>
              ) : (
                <><Lock className="size-3" /> Upgrade</>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('flashcards_practiced')}
          value={isLoading ? '...' : (stats?.flashcardsPracticed ?? 0)}
          icon={Brain}
          variant="violet"
        />
        <StatCard
          title={t('avg_score')}
          value={isLoading ? '...' : `${stats?.avgScore ?? 0}%`}
          icon={Target}
          variant="emerald"
        />
        <StatCard
          title={t('quizzes_taken')}
          value={isLoading ? '...' : (stats?.totalQuizzes ?? 0)}
          icon={FileText}
          variant="amber"
        />
        <StatCard
          title={t('accuracy')}
          value={isLoading ? '...' : `${stats?.flashcardAccuracy ?? 0}%`}
          icon={TrendingUp}
          variant="rose"
          progress={stats?.flashcardAccuracy}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="rounded-lg bg-primary/10 p-1.5">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              {t('quick_actions')}
            </CardTitle>
            <CardDescription>{t('flashcard_actions_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pb-6">
            <Link href="/app/study" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-violet-500/5 hover:bg-violet-500/10 border border-violet-500/10 hover:border-violet-500/25 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-violet-500/15 p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <RotateCcw className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('continue_reviewing')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('review_due_desc')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-violet-500 group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>

            <Link href="/app/quiz" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/10 hover:border-blue-500/25 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-blue-500/15 p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <BookOpen className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('take_quiz')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('take_quiz_desc')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-blue-500 group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>

            <Link href="/app/flashcards/decks" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/10 hover:border-emerald-500/25 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-emerald-500/15 p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <Layers className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('manage_decks')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('manage_decks_desc')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-500 group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>

            <Link href="/app/flashcards" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/10 hover:border-amber-500/25 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-amber-500/15 p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('manage_flashcards')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('manage_flashcards_desc')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-amber-500 group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{t('content_overview_title')}</CardTitle>
            <CardDescription>{t('content_overview_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="pb-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between p-4 rounded-xl hover:bg-muted/60 border border-transparent hover:border-border/60 transition-all duration-150 group">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-violet-500/10 p-2.5 shrink-0">
                    <Layers className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{t('total_decks')}</p>
                    <p className="text-xs text-muted-foreground">{t('manage_decks_desc')}</p>
                  </div>
                </div>
                {isLoading ? (
                  <div className="h-9 w-12 rounded-lg bg-muted animate-pulse" />
                ) : (
                  <span className="text-3xl font-bold tabular-nums text-foreground">
                    {stats?.totalDecks ?? 0}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl hover:bg-muted/60 border border-transparent hover:border-border/60 transition-all duration-150 group">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-amber-500/10 p-2.5 shrink-0">
                    <Brain className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{t('flashcards')}</p>
                    <p className="text-xs text-muted-foreground">{t('manage_flashcards_desc')}</p>
                  </div>
                </div>
                {isLoading ? (
                  <div className="h-9 w-12 rounded-lg bg-muted animate-pulse" />
                ) : (
                  <span className="text-3xl font-bold tabular-nums text-foreground">
                    {stats?.totalFlashcards ?? 0}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl hover:bg-muted/60 border border-transparent hover:border-border/60 transition-all duration-150 group">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-emerald-500/10 p-2.5 shrink-0">
                    <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{t('reviews_this_week')}</p>
                    <p className="text-xs text-muted-foreground">{t('continue_reviewing_desc')}</p>
                  </div>
                </div>
                {isLoading ? (
                  <div className="h-9 w-12 rounded-lg bg-muted animate-pulse" />
                ) : (
                  <span className="text-3xl font-bold tabular-nums text-foreground">
                    {stats?.flashcardsPracticed ?? 0}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
