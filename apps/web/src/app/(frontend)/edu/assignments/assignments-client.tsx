'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useApiQuery } from '@/hooks/use-api';
import { assignmentKeys } from '@/lib/query-keys';

interface Assignment {
  id: string;
  title: string;
  description: string | null;
  status: 'draft' | 'published';
  deadline: string | null;
  question_count: number;
  total_points: number;
  created_at: string;
}

export default function EduAssignmentsClient() {
  const t = useTranslations('EduAssignmentsPage');
  const locale = useLocale();

  const { data: assignments, isLoading } = useApiQuery<Assignment[]>({
    queryKey: assignmentKeys.all,
    url: '/api/v1/teacher/assignments',
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString(locale);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Link href="/edu/assignments/new">
          <Button>
            <Plus className="w-4 h-4 mr-1.5" />
            {t('new_assignment')}
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-5 w-3/4 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted mt-2" />
              </CardHeader>
              <CardContent>
                <div className="h-3 w-full rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : assignments?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">{t('empty')}</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-6">{t('empty_desc')}</p>
          <Link href="/edu/assignments/new">
            <Button>
              <Plus className="w-4 h-4 mr-1.5" />
              {t('new_assignment')}
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {assignments?.map((assignment: Assignment) => (
            <Link key={assignment.id} href={`/edu/assignments/${assignment.id}`}>
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base">{assignment.title}</CardTitle>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        assignment.status === 'published'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                      }`}
                    >
                      {assignment.status === 'published' ? t('published') : t('draft')}
                    </span>
                  </div>
                  {assignment.description && (
                    <CardDescription className="line-clamp-1">
                      {assignment.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{t('questions', { count: assignment.question_count })}</span>
                    <span>{t('pts', { count: assignment.total_points })}</span>
                    {assignment.deadline && (
                      <span>{t('due', { date: formatDate(assignment.deadline) })}</span>
                    )}
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
