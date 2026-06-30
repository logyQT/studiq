'use client';

import { ClipboardList } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Attempt = {
  id: string;
  score: number;
  totalQuestions: number;
  startedAt: string;
  completedAt: string | null;
};

export function QuizzesTab() {
  const t = useTranslations('AppStatsPage');
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/stats/student')
      .then((r) => r.json())
      .then((data) => {
        const stats = data.data || data;
        setAttempts(stats.recentAttempts || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (attempts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <ClipboardList className="size-10" />
        <p>{t('quizzes_coming_soon')}</p>
      </div>
    );
  }

  const avgScore = Math.round(attempts.reduce((s, a) => s + a.score, 0) / attempts.length);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t('quizzes_taken')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{attempts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t('avg_score')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{avgScore}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t('quiz_history')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{t('quiz_history_desc')}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('quiz_history')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('quiz_attempt')}</TableHead>
                <TableHead className="text-right">{t('score')}</TableHead>
                <TableHead className="text-right">{t('date')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts.map((attempt, i) => (
                <TableRow key={attempt.id}>
                  <TableCell className="font-medium">
                    {t('quiz_attempt')} #{i + 1}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={
                        attempt.score >= 70
                          ? 'default'
                          : attempt.score >= 40
                            ? 'secondary'
                            : 'destructive'
                      }
                    >
                      {attempt.score}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {attempt.completedAt
                      ? new Date(attempt.completedAt).toLocaleDateString()
                      : new Date(attempt.startedAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
