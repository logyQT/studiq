'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen, Brain, ListPlus, TrendingUp } from 'lucide-react';

interface StudentStats {
  totalQuizzes: number;
  avgScore: number;
  totalQuestionsCreated: number;
  flashcardsPracticed: number;
  flashcardAccuracy: number;
  attemptsOverTime: Array<{ date: string; score: number; total: number; percentage: number }>;
}

export default function AppStatsPage() {
  const t = useTranslations('AppStatisticsPage');
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

  if (loading) return <div className="flex justify-center py-12">{t('common_loading')}</div>;

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">{t('title')}</h2>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t('quizzes_taken')} value={stats?.totalQuizzes ?? 0} icon={BookOpen} />
        <StatCard title={t('avg_score')} value={`${stats?.avgScore ?? 0}%`} icon={TrendingUp} />
        <StatCard
          title={t('flashcards_practiced')}
          value={stats?.flashcardsPracticed ?? 0}
          icon={Brain}
        />
        <StatCard
          title={t('flashcard_accuracy')}
          value={`${stats?.flashcardAccuracy ?? 0}%`}
          icon={ListPlus}
        />
      </div>

      {stats?.attemptsOverTime && stats.attemptsOverTime.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('quiz_history_title')}</CardTitle>
            <CardDescription>{t('quiz_history_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.attemptsOverTime.slice(0, 10).map((attempt, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="text-sm font-medium">{t('quiz_attempt')}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(attempt.date).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className="font-bold"
                      style={{ color: attempt.percentage >= 70 ? 'hsl(var(--chart-2))' : 'hsl(var(--destructive))' }}
                    >
                      {attempt.percentage}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {attempt.score}/{attempt.total}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
