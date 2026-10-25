'use client';

import type { StudentStatsResponse } from '@studiq/server/models/stats.model';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { ClipboardList } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useApiQuery } from '@/hooks/use-api';
import { quizAttemptKeys, studentStatsKeys } from '@/lib/query-keys';
import { attemptScoreDisplay, formatScorePercent } from '@/lib/stats';

/** Same shape as the `/api/v1/quiz/attempts` rows (see `quiz-content.tsx`). */
interface QuizAttempt {
  id: string;
  /** `null` = results withheld by the assignment's „Pokaż wyniki” switch (#374). */
  score: number | null;
  total_questions: number;
  total_points: number | null;
  /** Questions that can be auto-graded (`type !== 'open'`) — the practice denominator (#329). */
  gradable_questions: number;
  assignment_id: string | null;
  started_at: string;
  completed_at: string | null;
}

type CompletedQuizAttempt = QuizAttempt & { completed_at: string };

export function QuizzesTab() {
  const t = useTranslations('AppStatsPage');
  const locale = useLocale();

  // `staleTime: 0` keeps the history fresh after a submission (the quiz session
  // invalidates `quizAttemptKeys.all`) and after a full page reload. The list is
  // the source of the rows; the stats endpoint only supplies the two summary cards.
  const { data: attempts, isLoading: attemptsLoading } = useApiQuery<QuizAttempt[]>({
    queryKey: quizAttemptKeys.all,
    url: '/api/v1/quiz/attempts',
    staleTime: 0,
  });

  const { data: stats, isLoading: statsLoading } = useApiQuery<StudentStatsResponse>({
    queryKey: studentStatsKeys.all,
    url: '/api/v1/stats/student',
    staleTime: 0,
  });

  if (attemptsLoading || statsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // History is completed attempts only, newest completion first — the endpoint
  // orders by `started_at`, which can differ from the completion order.
  const completedAttempts = (attempts ?? [])
    .filter((attempt): attempt is CompletedQuizAttempt => attempt.completed_at !== null)
    .sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at));

  if (completedAttempts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <ClipboardList className="size-10" />
        <p className="font-medium text-foreground">{t('no_quiz_history')}</p>
        <p className="text-sm">{t('no_quiz_history_desc')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t('quizzes_taken')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{completedAttempts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t('avg_score')}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Both summary metrics come from the server so they share one basis
                (assignments are scored against total_points, practice quizzes
                against their closed questions). `null` = nothing gradable yet,
                rendered as `—` rather than a fabricated 0 % (#619). */}
            <p className="text-3xl font-bold">{formatScorePercent(stats?.avgScore)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t('best_score')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatScorePercent(stats?.bestScore)}</p>
          </CardContent>
        </Card>
      </div>

      {stats?.avgScore === null && (
        <p className="text-sm text-muted-foreground">{t('no_graded_attempts')}</p>
      )}

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
              {completedAttempts.map((attempt, i) => {
                const display = attemptScoreDisplay(attempt);
                return (
                  <TableRow key={attempt.id}>
                    <TableCell className="font-medium">
                      {t('quiz_attempt')} #{i + 1}
                    </TableCell>
                    <TableCell className="text-right">
                      {display.kind === 'hidden' ? (
                        // A withheld result keeps the row (the attempt happened)
                        // but must never render a fabricated percentage (#374).
                        <span className="text-muted-foreground">{t('results_hidden')}</span>
                      ) : display.kind === 'self_check' ? (
                        // A practice attempt with no closed question has nothing
                        // auto-graded; the review page calls it the same thing (#329).
                        <Badge variant="outline">{t('self_check')}</Badge>
                      ) : (
                        <Badge
                          variant={
                            display.percentage >= 70
                              ? 'default'
                              : display.percentage >= 40
                                ? 'secondary'
                                : 'destructive'
                          }
                        >
                          {display.percentage}%
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {new Date(attempt.completed_at).toLocaleDateString(locale)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
