'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileText, TrendingDown } from 'lucide-react';

interface TeacherStats {
  totalQuestions: number;
  totalFlashcards: number;
  subject?: {
    totalQuestions: number;
    byType: Record<string, number>;
    byDifficulty: Record<string, number>;
    problematicQuestions: Array<{
      id: string;
      content: string;
      type: string;
      difficulty: string;
      correctRate: number;
    }>;
  };
}

interface Subject {
  id: string;
  name: string;
}

export default function EduStatsPage() {
  const t = useTranslations('EduStatisticsPage');
  const [stats, setStats] = useState<TeacherStats | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/subjects')
      .then((r) => r.json())
      .then(setSubjects);
  }, []);

  useEffect(() => {
    const url = selectedSubject
      ? `/api/v1/stats/teacher?subjectId=${selectedSubject}`
      : '/api/v1/stats/teacher';
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      });
  }, [selectedSubject]);

  if (loading) return <div className="flex justify-center py-12">{t('common_loading')}</div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <Select value={selectedSubject} onValueChange={setSelectedSubject}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder={t('all_subjects')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('all_subjects')}</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t('questions_stat')} value={stats?.totalQuestions ?? 0} icon={FileText} />
        <StatCard title={t('flashcards_stat')} value={stats?.totalFlashcards ?? 0} icon={FileText} />
      </div>

      {stats?.subject && (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('by_type_title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(stats.subject.byType || {}).map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between">
                      <span className="text-sm capitalize">{type.replace('_', ' ')}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('by_difficulty_title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(stats.subject.byDifficulty || {}).map(([diff, count]) => (
                    <div key={diff} className="flex items-center justify-between">
                      <span className="text-sm capitalize">{diff}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-red-500" />
                {t('problematic_title')}
              </CardTitle>
              <CardDescription>
                {t('problematic_desc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {stats.subject.problematicQuestions.length > 0 ? (
                <div className="space-y-3">
                  {stats.subject.problematicQuestions.map((q) => (
                    <div
                      key={q.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div>
                        <p className="font-medium text-sm">{q.content}</p>
                        <p className="text-xs text-muted-foreground">
                          {q.type} · {q.difficulty}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-red-600">
                        {Math.round(q.correctRate * 100)}% {t('correct_suffix')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">
                  {t('no_problematic')}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
