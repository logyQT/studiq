'use client';

import { Brain } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type QuizData = {
  id: string;
  title: string;
  totalAttempts: number;
  avgScore: number;
  avgCompletionRate: number;
};

export default function TeacherQuizStats() {
  const t = useTranslations('TeacherQuizStats');
  const [quizzes, setQuizzes] = useState<QuizData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/stats/teacher/quizzes')
      .then((r) => r.json())
      .then((data) => {
        setQuizzes(data.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('description')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Brain className="size-5 text-primary" />
            </div>
            <div>
              <CardTitle>{t('quiz_performance')}</CardTitle>
              <CardDescription>{t('quiz_performance_desc')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : quizzes.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('no_quizzes')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('table_quiz')}</TableHead>
                  <TableHead className="text-right">{t('table_attempts')}</TableHead>
                  <TableHead className="text-right">{t('table_avg_score')}</TableHead>
                  <TableHead className="text-right">{t('table_completion')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quizzes.map((quiz) => (
                  <TableRow key={quiz.id}>
                    <TableCell className="font-medium">{quiz.title}</TableCell>
                    <TableCell className="text-right">{quiz.totalAttempts}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={
                          quiz.avgScore >= 70
                            ? 'default'
                            : quiz.avgScore >= 40
                              ? 'secondary'
                              : 'destructive'
                        }
                      >
                        {Math.round(quiz.avgScore)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {Math.round(quiz.avgCompletionRate)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
