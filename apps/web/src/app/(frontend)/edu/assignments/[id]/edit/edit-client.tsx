'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  AssignmentForm,
  type AssignmentFormValues,
  type AssignmentPayload,
} from '@/components/edu/assignment-form';
import { AssignmentNotFound } from '@/components/edu/assignment-not-found';
import { AssignmentPage } from '@/components/edu/assignment-page';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useBreadcrumbLabel } from '@/hooks/use-breadcrumbs';
import { apiPut } from '@/lib/api';
import { dbToDatetimeLocal } from '@/lib/datetime';
import { assignmentKeys } from '@/lib/query-keys';

interface AssignmentDetail {
  id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  time_limit_min: number | null;
  shuffle_questions: boolean;
  shuffle_answers: boolean;
  show_results: boolean;
  max_attempts: number;
  passing_score: number | null;
}

export default function EditAssignmentClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('EduAssignmentEditPage');

  const { data: assignment, isLoading } = useApiQuery<AssignmentDetail>({
    queryKey: assignmentKeys.detail(id),
    url: `/api/v1/teacher/assignments/${id}`,
  });

  // The assignment title is the breadcrumb label; the raw UUID must never render.
  useBreadcrumbLabel(id, assignment?.title);

  const updateMutation = useApiMutation({
    mutationFn: async (body: AssignmentPayload) =>
      apiPut<unknown>(`/api/v1/teacher/assignments/${id}`, body),
    invalidateKeys: [assignmentKeys.detail(id), assignmentKeys.all],
  });

  const handleSubmit = async (payload: AssignmentPayload) => {
    await updateMutation.mutateAsync(payload);
    router.push(`/edu/assignments/${id}`);
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (!assignment) {
    return <AssignmentNotFound />;
  }

  const initial: AssignmentFormValues = {
    title: assignment.title,
    description: assignment.description ?? '',
    deadline: assignment.deadline ? dbToDatetimeLocal(assignment.deadline) : '',
    timeLimitMin: assignment.time_limit_min?.toString() ?? '',
    shuffleQuestions: assignment.shuffle_questions,
    shuffleAnswers: assignment.shuffle_answers,
    showResults: assignment.show_results,
    maxAttempts: assignment.max_attempts.toString(),
    passingScore: assignment.passing_score?.toString() ?? '',
  };

  return (
    <AssignmentPage title={t('title')} subtitle={t('subtitle')}>
      <AssignmentForm
        mode="edit"
        initial={initial}
        isPending={updateMutation.isPending}
        onSubmit={(payload) => {
          void handleSubmit(payload);
        }}
        onCancel={() => router.back()}
      />
    </AssignmentPage>
  );
}
