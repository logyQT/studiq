'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Layers, Plus, ArrowRight } from 'lucide-react';

interface TeacherStats {
  totalQuestions: number;
  totalFlashcards: number;
}

export default function EduOverviewPage() {
  const t = useTranslations('EduOverviewPage');
  const [stats, setStats] = useState<TeacherStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/stats/teacher')
      .then((res) => res.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t('total_questions')} value={loading ? '...' : stats?.totalQuestions ?? 0} icon={FileText} />
        <StatCard title={t('flashcards')} value={loading ? '...' : stats?.totalFlashcards ?? 0} icon={Layers} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('quick_actions')}</CardTitle>
            <CardDescription>{t('quick_actions_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/edu/questions">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> {t('create_question')}</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/edu/flashcards">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> {t('create_flashcard')}</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Content Overview</CardTitle>
            <CardDescription>Your teaching materials at a glance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium text-sm">Questions</p>
                    <p className="text-xs text-muted-foreground">Practice questions for students</p>
                  </div>
                </div>
                <span className="text-2xl font-bold">{loading ? '...' : stats?.totalQuestions ?? 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <Layers className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium text-sm">Flashcards</p>
                    <p className="text-xs text-muted-foreground">Study flashcards for students</p>
                  </div>
                </div>
                <span className="text-2xl font-bold">{loading ? '...' : stats?.totalFlashcards ?? 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
