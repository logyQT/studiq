'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { orderedQuestionTypeEntries } from '@/lib/stats';
import { BookOpen, ExternalLink, FileText, Layers, PieChart, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/** Radix Select cannot hold an empty value, so "no filter" needs a sentinel. */
const ALL_SUBJECTS = '__all__';

interface TeacherStats {
  totalQuestions: number;
  totalFlashcards: number;
  subject: {
    byType: Record<string, number>;
  };
  bySubject: Array<{
    subjectId: string;
    subjectName: string | null;
    questionCount: number;
  }>;
}

interface FlashcardStats {
  summary: {
    totalDecks: number;
    totalFlashcards: number;
    totalPractices: number;
    practicingStudents: number;
    rosterStudents: number | null;
  };
  byDeck: Array<{
    deckId: string;
    deckName: string;
    flashcardCount: number;
  }>;
  byTopic: Array<{
    topicId: string;
    topicName: string;
    flashcardCount: number;
  }>;
}

export default function StatsDataPage() {
  const t = useTranslations('StatsDataPage');
  const tc = useTranslations('Common');
  const [stats, setStats] = useState<TeacherStats | null>(null);
  const [flashStats, setFlashStats] = useState<FlashcardStats | null>(null);
  const [selectedSubject, setSelectedSubject] = useState(ALL_SUBJECTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/flashcards/stats/teacher', { signal: controller.signal })
      .then((r) => r.json())
      .then((f) => setFlashStats(f.data ?? f))
      .catch(() => {
        // Flashcard tables are supplementary; a failure leaves them hidden.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const url =
      selectedSubject === ALL_SUBJECTS
        ? '/api/v1/stats/teacher'
        : `/api/v1/stats/teacher?subjectId=${encodeURIComponent(selectedSubject)}`;

    fetch(url, { signal: controller.signal })
      .then((r) => r.json())
      .then((s) => {
        // Keep the previous payload mounted while re-filtering; only the first
        // load shows the loading text.
        setStats(s.data ?? s);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    // Aborting the stale request keeps rapid filter changes from applying out of order.
    return () => controller.abort();
  }, [selectedSubject]);

  if (loading) {
    return <div className="flex justify-center py-12 text-muted-foreground">Loading...</div>;
  }

  const typeEntries = orderedQuestionTypeEntries(stats?.subject.byType ?? {});
  const bySubject = stats?.bySubject ?? [];

  const typeLabel = (key: string) =>
    key === 'mcq' || key === 'true_false' || key === 'open'
      ? tc(`question_type_${key}`)
      : key.replaceAll('_', ' ');

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-1">{t('description')}</p>
        </div>
        <Select value={selectedSubject} onValueChange={setSelectedSubject}>
          <SelectTrigger className="w-48 truncate" aria-label={t('filter_subject')}>
            <SelectValue placeholder={t('all_subjects')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SUBJECTS}>{t('all_subjects')}</SelectItem>
            {bySubject.map((subject) => (
              <SelectItem key={subject.subjectId} value={subject.subjectId}>
                {subject.subjectName ?? t('unknown_subject')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t('total_questions')} value={stats?.totalQuestions ?? 0} icon={FileText} />
        <StatCard title={t('total_flashcards')} value={stats?.totalFlashcards ?? 0} icon={Layers} />
        <StatCard
          title={t('total_decks')}
          value={flashStats?.summary.totalDecks ?? 0}
          icon={BookOpen}
        />
        {flashStats?.summary.rosterStudents != null && (
          <StatCard
            title={t('students')}
            value={flashStats.summary.rosterStudents}
            description={t('active_students', {
              count: flashStats.summary.practicingStudents,
            })}
            progress={
              flashStats.summary.rosterStudents > 0
                ? (flashStats.summary.practicingStudents / flashStats.summary.rosterStudents) * 100
                : 0
            }
            icon={Users}
          />
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('by_type_title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {typeEntries.length > 0 ? (
              typeEntries.map(({ key, count }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm">{typeLabel(key)}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t('no_questions')}</p>
            )}
          </CardContent>
        </Card>

        {/* Deliberately global: it is the overview that explains the filter above. */}
        <Card>
          <CardHeader>
            <CardTitle>{t('by_subject_title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {bySubject.length > 0 ? (
              bySubject.map((subject) => (
                <div key={subject.subjectId} className="flex items-center justify-between">
                  <span className="text-sm">{subject.subjectName ?? t('unknown_subject')}</span>
                  <span className="font-medium tabular-nums">{subject.questionCount}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t('no_questions')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {flashStats && flashStats.byDeck.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              {t('deck_title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('th_deck')}</TableHead>
                  <TableHead className="text-right">{t('th_flashcards')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flashStats.byDeck.map((deck) => (
                  <TableRow key={deck.deckId}>
                    <TableCell className="font-medium">
                      <Link href={`/edu/flashcards/${deck.deckId}`} className="hover:underline">
                        {deck.deckName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{deck.flashcardCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {flashStats && flashStats.byTopic.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5" />
              {t('topic_title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('th_topic')}</TableHead>
                  <TableHead className="text-right">{t('th_flashcards')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flashStats.byTopic.map((topic) => (
                  <TableRow key={topic.topicId}>
                    <TableCell className="font-medium">{topic.topicName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {topic.flashcardCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-4">
        <Link
          href="/edu/statistics"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          {t('view_question_stats')}
        </Link>
        <Link
          href="/edu/flashcards/stats"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          {t('view_flashcard_stats')}
        </Link>
      </div>
    </div>
  );
}
