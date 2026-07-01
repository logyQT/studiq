'use client';

import { BookOpen, ExternalLink, FileText, Layers, PieChart, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface TeacherStats {
  totalQuestions: number;
  totalFlashcards: number;
  subject?: {
    byType: Record<string, number>;
    byDifficulty: Record<string, number>;
  };
}

interface Subject {
  id: string;
  name: string;
}

interface FlashcardStats {
  summary: {
    totalDecks: number;
    totalFlashcards: number;
    totalPractices: number;
    totalStudents: number;
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
  const [stats, setStats] = useState<TeacherStats | null>(null);
  const [flashStats, setFlashStats] = useState<FlashcardStats | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState('__all__');
  const [subjectBreakdown, setSubjectBreakdown] = useState<TeacherStats['subject'] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/stats/teacher').then((r) => r.json()),
      fetch('/api/v1/flashcards/stats/teacher').then((r) => r.json()),
      fetch('/api/v1/subjects').then((r) => r.json()),
    ])
      .then(([s, f, sub]) => {
        setStats(s.data ?? s);
        setFlashStats(f.data ?? f);
        setSubjects(sub.data ?? sub);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedSubject === '__all__') {
      setSubjectBreakdown(stats?.subject ?? null);
      return;
    }
    fetch(`/api/v1/stats/teacher?subjectId=${selectedSubject}`)
      .then((r) => r.json())
      .then((r) => setSubjectBreakdown((r.data ?? r)?.subject ?? null))
      .catch(() => setSubjectBreakdown(null));
  }, [selectedSubject, stats]);

  if (loading) {
    return <div className="flex justify-center py-12 text-muted-foreground">Loading...</div>;
  }

  const totalByType = Object.entries(subjectBreakdown?.byType ?? {}).map(([key, count]) => ({
    key,
    count,
  }));

  const totalByDifficulty = Object.entries(subjectBreakdown?.byDifficulty ?? {}).map(
    ([key, count]) => ({ key, count }),
  );

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-1">{t('description')}</p>
        </div>
        <Select value={selectedSubject} onValueChange={setSelectedSubject}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder={t('all_subjects')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('all_subjects')}</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
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
        <StatCard
          title={t('total_students')}
          value={flashStats?.summary.totalStudents ?? 0}
          icon={Users}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {totalByType.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('by_type_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {totalByType.map(({ key, count }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{key.replace('_', ' ')}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {totalByDifficulty.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>By Difficulty</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {totalByDifficulty.map(({ key, count }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm capitalize">{key}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {selectedSubject === '__all__' && totalByType.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('by_type_title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Select a subject to see question type breakdown
              </p>
            </CardContent>
          </Card>
        )}
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
                  <TableHead>Deck</TableHead>
                  <TableHead className="text-right">Flashcards</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flashStats.byDeck.map((deck) => (
                  <TableRow key={deck.deckId}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/edu/flashcards/decks/${deck.deckId}`}
                        className="hover:underline"
                      >
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
                  <TableHead>Topic</TableHead>
                  <TableHead className="text-right">Flashcards</TableHead>
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
