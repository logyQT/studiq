'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BookOpen,
  Brain,
  ListPlus,
  ArrowRight,
  BookText,
  Tags,
  FolderOpen,
  Layers,
  Zap,
  Sparkles,
} from 'lucide-react';

interface StudentStats {
  totalQuizzes: number;
  avgScore: number;
  totalQuestionsCreated: number;
  flashcardsPracticed: number;
  flashcardAccuracy: number;
}

export default function AppOverviewPage() {
  const t = useTranslations('AppOverviewPage');
  const [stats, setStats] = useState<StudentStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/stats/student')
      .then((r) => r.json())
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
          title={t('quizzes_taken')}
          value={loading ? '...' : (stats?.totalQuizzes ?? 0)}
          icon={BookOpen}
          variant="blue"
        />
        <StatCard
          title={t('avg_score')}
          value={loading ? '...' : `${stats?.avgScore ?? 0}%`}
          icon={BookOpen}
          variant="emerald"
          progress={loading ? undefined : (stats?.avgScore ?? 0)}
        />
        <StatCard
          title={t('flashcards_practiced')}
          value={loading ? '...' : (stats?.flashcardsPracticed ?? 0)}
          icon={Brain}
          variant="violet"
        />
        <StatCard
          title={t('questions_created')}
          value={loading ? '...' : (stats?.totalQuestionsCreated ?? 0)}
          icon={ListPlus}
          variant="amber"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Quiz Actions */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="rounded-lg bg-blue-500/10 p-1.5">
                <BookOpen className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              {t('quiz_actions')}
            </CardTitle>
            <CardDescription>{t('quiz_actions_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pb-6">
            <Link href="/app/quiz" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/10 hover:border-blue-500/25 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-blue-500/15 p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <BookOpen className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('take_quiz')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('quiz_actions_desc')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-blue-500 group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>

            <Link href="/app/my-questions" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/10 hover:border-amber-500/25 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-amber-500/15 p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <ListPlus className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('create_question')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('quiz_actions_desc')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-amber-500 group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>

            <Link href="/app/quiz" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl hover:bg-muted/60 border border-transparent hover:border-border/60 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-muted p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <BookText className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('view_subjects')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>
          </CardContent>
        </Card>

        {/* Flashcard Actions */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="rounded-lg bg-violet-500/10 p-1.5">
                <Brain className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              {t('flashcard_actions')}
            </CardTitle>
            <CardDescription>{t('flashcard_actions_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pb-6">
            {/* Hero: Quick Practice */}
            <Link href="/app/flashcards/session?mode=quick&limit=5" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-violet-500/10 to-primary/10 hover:from-violet-500/15 hover:to-primary/15 border border-violet-500/15 hover:border-violet-500/30 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-gradient-to-br from-violet-500 to-primary p-3 shrink-0 shadow-sm group-hover:shadow-md group-hover:scale-110 transition-all duration-200">
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-foreground">{t('quick_practice')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('flashcard_actions_desc')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-primary group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>

            <Link href="/app/flashcards" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl hover:bg-muted/60 border border-transparent hover:border-border/60 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-muted p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <Tags className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('manage_topics')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>

            <Link href="/app/flashcards/decks" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl hover:bg-muted/60 border border-transparent hover:border-border/60 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-muted p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <FolderOpen className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('manage_decks')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>

            <Link href="/app/flashcards" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl hover:bg-muted/60 border border-transparent hover:border-border/60 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-muted p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <Layers className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('manage_flashcards')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>

            <Link href="/app/flashcards/ai" className="group block">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/10 hover:border-emerald-500/25 transition-all duration-200 cursor-pointer">
                <div className="rounded-xl bg-emerald-500/15 p-3 shrink-0 group-hover:scale-110 transition-transform duration-200">
                  <Sparkles className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{t('new_flashcard')}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-500 group-hover:translate-x-1 transition-all duration-200 shrink-0" />
              </div>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
