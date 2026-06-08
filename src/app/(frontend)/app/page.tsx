'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  BookOpen,
  Brain,
  ListPlus,
  ArrowRight,
  BookText,
  Tags,
  FolderOpen,
  Layers,
  Plus,
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('quizzes_taken')}
          value={loading ? '...' : (stats?.totalQuizzes ?? 0)}
          icon={BookOpen}
        />
        <StatCard
          title={t('avg_score')}
          value={loading ? '...' : `${stats?.avgScore ?? 0}%`}
          icon={BookOpen}
        />
        <StatCard
          title={t('flashcards_practiced')}
          value={loading ? '...' : (stats?.flashcardsPracticed ?? 0)}
          icon={Brain}
        />
        <StatCard
          title={t('questions_created')}
          value={loading ? '...' : (stats?.totalQuestionsCreated ?? 0)}
          icon={ListPlus}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('quiz_actions')}</CardTitle>
            <CardDescription>{t('quiz_actions_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/app/quiz">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4" /> {t('take_quiz')}
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/app/my-questions">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <ListPlus className="h-4 w-4" /> {t('create_question')}
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/app/quiz">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <BookText className="h-4 w-4" /> {t('view_subjects')}
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('flashcard_actions')}</CardTitle>
            <CardDescription>{t('flashcard_actions_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/app/flashcards/session?mode=quick&limit=5">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Brain className="h-4 w-4" /> {t('quick_practice')}
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/app/flashcards">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Tags className="h-4 w-4" /> {t('manage_topics')}
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/app/flashcards/decks">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" /> {t('manage_decks')}
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/app/flashcards">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Layers className="h-4 w-4" /> {t('manage_flashcards')}
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/edu/flashcards">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4" /> {t('new_flashcard')}
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
