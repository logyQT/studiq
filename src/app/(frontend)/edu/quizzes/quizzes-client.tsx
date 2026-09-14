'use client';

import { Plus, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiQuery } from '@/hooks/use-api';
import { formatDateTime } from '@/lib/datetime';
import { quizKeys } from '@/lib/query-keys';

interface Quiz {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  quiz_questions: { count: number }[];
}

export function QuizzesClient() {
  const t = useTranslations('EduQuizzesPage');
  const locale = useLocale();

  const { data: quizzes, isLoading } = useApiQuery<Quiz[]>({
    queryKey: quizKeys.all,
    url: '/api/v1/teacher/quizzes',
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Link href="/edu/quizzes/new">
          <Button>
            <Plus className="w-4 h-4 mr-1" /> {t('new_quiz')}
          </Button>
        </Link>
      </div>

      {!quizzes || quizzes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ScrollText className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">{t('empty')}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('empty_desc')}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {quizzes.map((quiz) => (
            <Link key={quiz.id} href={`/edu/quizzes/${quiz.id}`}>
              <Card className="h-full hover:bg-accent/50 transition-colors cursor-pointer">
                <CardHeader>
                  <CardTitle className="text-base">{quiz.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {quiz.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                      {quiz.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{t('questions', { count: quiz.quiz_questions?.[0]?.count ?? 0 })}</span>
                    <span>
                      {t('last_updated', { date: formatDateTime(quiz.created_at, locale) })}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
