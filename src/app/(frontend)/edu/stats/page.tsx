'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Layers, FileText, Brain, GraduationCap, ArrowRight } from 'lucide-react';

type TeacherStats = {
  totalQuestions: number;
  totalFlashcards: number;
};

type QuizSummary = {
  id: string;
  title: string;
  totalAttempts: number;
  avgScore: number;
};

export default function TeacherStatsOverview() {
  const t = useTranslations('TeacherStatsOverview');
  const [stats, setStats] = useState<TeacherStats | null>(null);
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/stats/teacher').then((r) => r.json()),
      fetch('/api/v1/stats/teacher/quizzes').then((r) => r.json()).catch(() => ({ data: [] })),
    ])
      .then(([statsData, quizData]) => {
        setStats(statsData.data || statsData);
        setQuizzes(quizData.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('description')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('total_flashcards')}
          value={loading ? '...' : (stats?.totalFlashcards ?? 0)}
          icon={Layers}
        />
        <StatCard
          title={t('total_questions')}
          value={loading ? '...' : (stats?.totalQuestions ?? 0)}
          icon={FileText}
        />
        <StatCard
          title={t('quiz_attempts')}
          value={loading ? '...' : (quizzes.length > 0 ? quizzes.reduce((s, q) => s + q.totalAttempts, 0) : 0)}
          icon={Brain}
        />
        <StatCard
          title={t('avg_quiz_score')}
          value={
            loading
              ? '...'
              : quizzes.length > 0
                ? Math.round(quizzes.reduce((s, q) => s + q.avgScore, 0) / quizzes.length) + '%'
                : '—'
          }
          icon={GraduationCap}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/edu/flashcards/stats" className="group block">
          <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="size-4 text-primary" />
                {t('flashcard_stats')}
                <ArrowRight className="size-4 ml-auto text-muted-foreground group-hover:translate-x-1 transition-transform" />
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {t('flashcard_stats_desc')}
            </CardContent>
          </Card>
        </Link>

        <Link href="/edu/statistics" className="group block">
          <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="size-4 text-primary" />
                {t('question_stats')}
                <ArrowRight className="size-4 ml-auto text-muted-foreground group-hover:translate-x-1 transition-transform" />
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {t('question_stats_desc')}
            </CardContent>
          </Card>
        </Link>

        <Link href="/edu/stats/quizzes" className="group block">
          <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="size-4 text-primary" />
                {t('quiz_stats')}
                <ArrowRight className="size-4 ml-auto text-muted-foreground group-hover:translate-x-1 transition-transform" />
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {t('quiz_stats_desc')}
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
