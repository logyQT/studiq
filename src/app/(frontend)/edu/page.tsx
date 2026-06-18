'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Layers, Plus, ArrowRight, Zap } from 'lucide-react';

interface TeacherStats {
  totalQuestions: number;
  totalFlashcards: number;
}

export default function EduOverviewPage() {
  const t = useTranslations('EduOverviewPage');
  const [stats, setStats] = useState<TeacherStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/stats/teacher')
      .then((res) => res.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
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
      </div>

      <div className="grid gap-6 md:grid-cols-2">
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
            {/* Create question CTA */}
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

            {/* Create flashcard CTA */}
            <Link href="/edu/flashcards" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-violet-500/5 hover:bg-violet-500/10 border border-violet-500/10 hover:border-violet-500/25 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-violet-500/15 p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <Plus className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('create_flashcard')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('flashcards_card_desc')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-violet-500 group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>
          </CardContent>
        </Card>

        {/* Content Overview */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{t('content_overview_title')}</CardTitle>
            <CardDescription>{t('content_overview_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="pb-6">
            <div className="space-y-2">
              {/* Questions row */}
              <div className="flex items-center justify-between p-4 rounded-xl hover:bg-muted/60 border border-transparent hover:border-border/60 transition-all duration-150 group">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-500/10 p-2.5 shrink-0">
                    <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{t('questions_card_title')}</p>
                    <p className="text-xs text-muted-foreground">{t('questions_card_desc')}</p>
                  </div>
                </div>
                {loading ? (
                  <div className="h-9 w-12 rounded-lg bg-muted animate-pulse" />
                ) : (
                  <span className="text-3xl font-bold tabular-nums text-foreground">
                    {stats?.totalQuestions ?? 0}
                  </span>
                )}
              </div>

              {/* Flashcards row */}
              <div className="flex items-center justify-between p-4 rounded-xl hover:bg-muted/60 border border-transparent hover:border-border/60 transition-all duration-150 group">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-violet-500/10 p-2.5 shrink-0">
                    <Layers className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{t('flashcards_card_title')}</p>
                    <p className="text-xs text-muted-foreground">{t('flashcards_card_desc')}</p>
                  </div>
                </div>
                {loading ? (
                  <div className="h-9 w-12 rounded-lg bg-muted animate-pulse" />
                ) : (
                  <span className="text-3xl font-bold tabular-nums text-foreground">
                    {stats?.totalFlashcards ?? 0}
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
