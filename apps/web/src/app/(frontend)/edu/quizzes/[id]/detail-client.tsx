'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@studiq/ui';
import { ArrowLeft, Edit, ScrollText, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { PlanLockedCard } from '@/components/shared/plan-locked-card';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useBreadcrumbLabel } from '@/hooks/use-breadcrumbs';
import { useEntitlement } from '@/hooks/use-entitlement';
import { useEntitlements } from '@/hooks/use-entitlements';
import { quizKeys } from '@/lib/query-keys';

interface QuizDetail {
  id: string;
  name: string;
  description: string | null;
  quiz_questions: {
    question_id: string;
    order_index: number;
    points: number;
    question?: {
      id: string;
      content: string;
      type: string;
    };
  }[];
}

export function QuizDetailClient() {
  const t = useTranslations('EduQuizDetailPage');
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: quiz, isLoading } = useApiQuery<QuizDetail>({
    queryKey: quizKeys.detail(id),
    url: `/api/v1/teacher/quizzes/${id}`,
  });

  // The quiz name is the breadcrumb leaf; the raw quiz UUID must never render.
  useBreadcrumbLabel(id, quiz?.name);

  // The quiz read stays open (phase 5d); only the writes that would 403 are
  // withheld: unentitled, the edit link and the delete button are replaced by
  // the plan card, so no control on the page can fail with 403. The
  // „create assignment” link stays: it uses the free ad-hoc assignment path.
  const canTemplates = useEntitlement()('quiz.templates');
  const { isPending: entitlementsPending } = useEntitlements();

  const deleteMutation = useApiMutation<void, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/teacher/quizzes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
    },
    invalidateKeys: [quizKeys.all],
  });

  const handleDelete = async () => {
    if (!confirm(t('delete_confirm'))) return;
    try {
      await deleteMutation.mutateAsync();
      toast.success('Quiz deleted');
      router.push('/edu/quizzes');
    } catch {
      toast.error('Delete failed');
    }
  };

  if (isLoading || entitlementsPending) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!quiz) {
    return <div className="p-6 text-center text-muted-foreground">{t('not_found')}</div>;
  }

  const questions = quiz.quiz_questions.toSorted((a, b) => a.order_index - b.order_index);
  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/edu/quizzes" className="hover:text-foreground">
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          {t('edit')}
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{quiz.name}</h1>
          {quiz.description && (
            <p className="text-sm text-muted-foreground mt-1">{quiz.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          {!canTemplates ? (
            <div className="w-72">
              <PlanLockedCard
                title={t('locked_title')}
                description={t('locked_desc')}
                cta={t('locked_cta')}
              />
            </div>
          ) : (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/edu/quizzes/${id}/edit`}>
                  <Edit className="w-4 h-4 mr-1" /> {t('edit')}
                </Link>
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                <Trash2 className="w-4 h-4 mr-1" /> {t('delete')}
              </Button>
            </>
          )}
          <Link href={`/edu/assignments/new?quizId=${id}`}>
            <Button variant="outline" size="sm">
              <Send className="w-4 h-4 mr-1" /> {t('create_assignment')}
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {[
          { label: t('questions'), value: questions.length },
          { label: t('total_points'), value: totalPoints },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {questions.length > 0 ? (
        <div className="space-y-2">
          {questions.map((q, i) => (
            <Card key={q.question_id}>
              <CardContent className="flex items-start gap-3 p-4">
                <span className="text-sm font-medium text-muted-foreground w-6 shrink-0">
                  {i + 1}.
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{q.question?.content ?? q.question_id}</p>
                  {q.question && (
                    <Badge variant="outline" className="mt-1 text-xs">
                      {q.question.type.replace('_', ' ')}
                    </Badge>
                  )}
                </div>
                <span className="text-sm text-muted-foreground shrink-0">{q.points} pts</span>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ScrollText className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('not_found')}</p>
        </div>
      )}
    </div>
  );
}
