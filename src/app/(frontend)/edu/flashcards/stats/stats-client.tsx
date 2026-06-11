'use client';

import { useRef, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import {
  Layers,
  FileText,
  BookOpen,
  Users,
  TrendingUp,
  Brain,
  ArrowLeft,
  BarChart3,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from '@/components/ui/empty';
import { channel, useRealtimeChannel } from '@/hooks/use-realtime-channel';
import { DeckDetailSkeleton } from '@/components/flashcards/deck-detail-skeleton';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';
import type { TeacherFlashcardStatsResponse } from '@/server/models';

export default function EduFlashcardStatsClient() {
  const t = useTranslations('EduFlashcardStatsPage');
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading } = useApiQuery<TeacherFlashcardStatsResponse>({
    queryKey: flashcardKeys.stats.teacher,
    url: '/api/v1/flashcards/stats/teacher',
  });

  const invalidateWithDebounce = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: flashcardKeys.stats.teacher });
    }, 1000); // FIXME: restore 10000ms debounce after dev testing
  }, [queryClient]);

  useRealtimeChannel(
    channel('teacher-flashcard-stats')
      .listen('flashcard_practice', invalidateWithDebounce)
      .listen('flashcard_review_state', invalidateWithDebounce),
  );

  if (isLoading) return <DeckDetailSkeleton />;

  if (!data || data.summary.totalFlashcards === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/edu/flashcards">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> {t('back')}
            </Button>
          </Link>
          <h2 className="text-2xl font-bold">{t('title')}</h2>
        </div>
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <BarChart3 className="h-10 w-10 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>{t('empty_title')}</EmptyTitle>
            <EmptyDescription>{t('empty_desc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const { summary, byDeck, byTopic } = data;
  const maxPracticeCount = Math.max(...byDeck.map((d) => d.practiceCount), 1);
  const difficultyTotal =
    summary.difficultyBreakdown.easy +
    summary.difficultyBreakdown.medium +
    summary.difficultyBreakdown.hard +
    summary.difficultyBreakdown.new;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/edu/flashcards">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" /> {t('back')}
          </Button>
        </Link>
        <h2 className="text-2xl font-bold">{t('title')}</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard title={t('summary_decks')} value={summary.totalDecks} icon={Layers} />
        <StatCard title={t('summary_flashcards')} value={summary.totalFlashcards} icon={FileText} />
        <StatCard title={t('summary_practices')} value={summary.totalPractices} icon={BookOpen} />
        <StatCard title={t('summary_students')} value={summary.totalStudents} icon={Users} />
        <StatCard
          title={t('summary_accuracy')}
          value={`${summary.overallAccuracy}%`}
          icon={TrendingUp}
        />
        <StatCard
          title={t('summary_ef')}
          value={summary.averageEasinessFactor.toFixed(2)}
          icon={Brain}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {t('chart_difficulty')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              {
                key: 'easy',
                label: t('difficulty_easy'),
                count: summary.difficultyBreakdown.easy,
                color: 'bg-emerald-500',
              },
              {
                key: 'medium',
                label: t('difficulty_medium'),
                count: summary.difficultyBreakdown.medium,
                color: 'bg-amber-500',
              },
              {
                key: 'hard',
                label: t('difficulty_hard'),
                count: summary.difficultyBreakdown.hard,
                color: 'bg-red-500',
              },
              {
                key: 'new',
                label: t('difficulty_new'),
                count: summary.difficultyBreakdown.new,
                color: 'bg-slate-400',
              },
            ].map((item) => (
              <Link
                key={item.key}
                href={`/edu/flashcards/stats/difficulty/${item.key}`}
                className="flex items-center gap-3 rounded-md transition-colors hover:bg-muted/50 px-1 -mx-1"
              >
                <span className="w-16 text-sm font-medium text-right">{item.label}</span>
                <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full ${item.color} transition-all duration-500 rounded-full`}
                    style={{
                      width: `${difficultyTotal > 0 ? (item.count / difficultyTotal) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="w-12 text-sm text-muted-foreground tabular-nums text-right">
                  {item.count}
                </span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {t('table_deck_title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table_deck')}</TableHead>
                <TableHead className="text-right">{t('table_flashcards')}</TableHead>
                <TableHead className="text-right">{t('table_practices')}</TableHead>
                <TableHead className="text-right">{t('table_accuracy')}</TableHead>
                <TableHead className="text-right">{t('table_ef')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byDeck.map((deck) => (
                <TableRow key={deck.deckId}>
                  <TableCell className="font-medium">
                    <Link href={`/edu/flashcards/decks/${deck.deckId}`} className="hover:underline">
                      {deck.deckName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{deck.flashcardCount}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{
                            width: `${maxPracticeCount > 0 ? (deck.practiceCount / maxPracticeCount) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span>{deck.practiceCount}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{deck.accuracy}%</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {deck.avgEasinessFactor > 0 ? deck.avgEasinessFactor.toFixed(2) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {byTopic.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              {t('topic_table_title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('topic_table_name')}</TableHead>
                  <TableHead className="text-right">{t('topic_table_flashcards')}</TableHead>
                  <TableHead className="text-right">{t('topic_table_practices')}</TableHead>
                  <TableHead className="text-right">{t('topic_table_accuracy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byTopic.map((topic) => (
                  <TableRow key={topic.topicId}>
                    <TableCell className="font-medium">{topic.topicName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {topic.flashcardCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{topic.practiceCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{topic.accuracy}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
