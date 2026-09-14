'use client';

import { Brain, ExternalLink, FileText, GraduationCap, Layers, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface QuizSummary {
  id: string;
  title: string;
  totalAttempts: number;
  avgScore: number;
}

interface FlashcardSummary {
  totalDecks: number;
  totalFlashcards: number;
  totalPractices: number;
  totalStudents: number;
  overallAccuracy: number;
  averageEasinessFactor: number;
  difficultyBreakdown: {
    easy: number;
    medium: number;
    hard: number;
    new: number;
  };
}

interface FlashcardStats {
  summary: FlashcardSummary;
  byDeck: Array<{
    deckId: string;
    deckName: string;
    flashcardCount: number;
    practiceCount: number;
    accuracy: number;
    avgEasinessFactor: number;
  }>;
}

interface ProblematicQuestion {
  id: string;
  content: string;
  type: string;
  correctRate: number;
}

const difficultyConfig = [
  { key: 'easy', labelKey: 'difficulty_easy', color: 'bg-emerald-500' },
  { key: 'medium', labelKey: 'difficulty_medium', color: 'bg-amber-500' },
  { key: 'hard', labelKey: 'difficulty_hard', color: 'bg-red-500' },
  { key: 'new', labelKey: 'difficulty_new', color: 'bg-slate-400' },
] as const;

export default function StatsResultsPage() {
  const t = useTranslations('StatsResultsPage');
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [flashStats, setFlashStats] = useState<FlashcardStats | null>(null);
  const [problematic, setProblematic] = useState<ProblematicQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/stats/teacher/quizzes')
        .then((r) => r.json())
        .catch(() => ({ data: [] })),
      fetch('/api/v1/flashcards/stats/teacher').then((r) => r.json()),
      fetch('/api/v1/stats/teacher')
        .then((r) => r.json())
        .then((r) => (r.data ?? r)?.subject?.problematicQuestions ?? []),
    ])
      .then(([q, f, p]) => {
        setQuizzes(q.data ?? []);
        setFlashStats(f.data ?? f);
        setProblematic(p);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const totalQuizAttempts = quizzes.reduce((s, q) => s + q.totalAttempts, 0);
  const avgQuizScore =
    quizzes.length > 0
      ? Math.round(quizzes.reduce((s, q) => s + q.avgScore, 0) / quizzes.length)
      : null;

  const diffTotal = flashStats
    ? flashStats.summary.difficultyBreakdown.easy +
      flashStats.summary.difficultyBreakdown.medium +
      flashStats.summary.difficultyBreakdown.hard +
      flashStats.summary.difficultyBreakdown.new
    : 0;

  const sortedProblematic = [...problematic].sort((a, b) => a.correctRate - b.correctRate);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('description')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title={t('quiz_attempts')}
          value={loading ? '...' : totalQuizAttempts}
          icon={Brain}
        />
        <StatCard
          title={t('avg_quiz_score')}
          value={loading ? '...' : avgQuizScore !== null ? `${avgQuizScore}%` : '\u2014'}
          icon={GraduationCap}
        />
        <StatCard
          title={t('total_practices')}
          value={loading ? '...' : (flashStats?.summary.totalPractices ?? 0)}
          icon={TrendingUp}
        />
        <StatCard
          title={t('overall_accuracy')}
          value={loading ? '...' : `${flashStats?.summary.overallAccuracy ?? 0}%`}
          icon={FileText}
        />
        <StatCard
          title={t('avg_ef')}
          value={loading ? '...' : (flashStats?.summary.averageEasinessFactor ?? 0).toFixed(2)}
          icon={Layers}
        />
      </div>

      {flashStats && diffTotal > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('chart_difficulty')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {difficultyConfig.map(({ key, labelKey, color }) => {
              const count =
                flashStats.summary.difficultyBreakdown[
                  key as keyof typeof flashStats.summary.difficultyBreakdown
                ];
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-16 text-sm font-medium text-right">{t(labelKey)}</span>
                  <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${color} transition-all duration-500 rounded-full`}
                      style={{
                        width: `${(count / diffTotal) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="w-12 text-sm text-muted-foreground tabular-nums text-right">
                    {count}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {quizzes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Quiz Performance
            </CardTitle>
            <CardDescription>Per-quiz attempt and score summary</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quiz</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead className="text-right">Avg Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quizzes.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-medium">{q.title}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.totalAttempts}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Badge
                        variant={
                          q.avgScore >= 70
                            ? 'default'
                            : q.avgScore >= 40
                              ? 'secondary'
                              : 'destructive'
                        }
                      >
                        {Math.round(q.avgScore)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {sortedProblematic.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-red-500" />
              {t('problematic_title')}
            </CardTitle>
            <CardDescription>{t('problematic_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sortedProblematic.map((q) => (
              <div key={q.id} className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <p className="font-medium text-sm">{q.content}</p>
                  <p className="text-xs text-muted-foreground">{q.type}</p>
                </div>
                <span className="text-sm font-bold text-red-600 tabular-nums">
                  {Math.round(q.correctRate * 100)}% {t('correct_suffix')}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!loading && sortedProblematic.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t('problematic_title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground py-4 text-center">{t('no_problematic')}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-4">
        <Link
          href="/edu/stats/quizzes"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          {t('view_quiz_stats')}
        </Link>
        <Link
          href="/edu/flashcards/stats"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          {t('view_flashcard_stats')}
        </Link>
        <Link
          href="/edu/statistics"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          {t('view_question_stats')}
        </Link>
      </div>
    </div>
  );
}
