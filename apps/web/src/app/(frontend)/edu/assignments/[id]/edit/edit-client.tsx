'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  AssignmentForm,
  type AssignmentFormValues,
  type AssignmentPayload,
} from '@/components/edu/assignment-form';
import { AssignmentNotFound } from '@/components/edu/assignment-not-found';
import { AssignmentPage } from '@/components/edu/assignment-page';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useBreadcrumbLabel } from '@/hooks/use-breadcrumbs';
import { ApiError, apiPost, apiPut, getFieldErrorCode } from '@/lib/api';
import { dbToDatetimeLocal } from '@/lib/datetime';
import { translateErrorCode } from '@/lib/error-messages';
import { assignmentKeys } from '@/lib/query-keys';

interface AssignmentDetail {
  id: string;
  title: string;
  description: string | null;
  status: string;
  start_time: string | null;
  deadline: string | null;
  /** Written by the durable close; a later deadline edit cannot reopen the run. */
  closed_at: string | null;
  time_limit_min: number | null;
  shuffle_questions: boolean;
  shuffle_answers: boolean;
  show_results: boolean;
  max_attempts: number;
  attempt_item_count: number | null;
  allow_same_item_retake: boolean;
  unseen_only: boolean;
  passing_score: number | null;
}

export default function EditAssignmentClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('EduAssignmentEditPage');
  const tErrors = useTranslations('Errors');
  /** The server's per-field refusal of the deadline, as an `Errors` code (R12/R20). */
  const [deadlineError, setDeadlineError] = useState<string | null>(null);

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

  // Ending a live run early is its own recorded action, never a deadline in the past (#1191).
  const closeMutation = useApiMutation({
    mutationFn: () => apiPost<unknown>(`/api/v1/teacher/assignments/${id}/close`, undefined),
    invalidateKeys: [assignmentKeys.detail(id), assignmentKeys.all],
  });

  const handleSubmit = async (payload: AssignmentPayload) => {
    setDeadlineError(null);
    try {
      await updateMutation.mutateAsync(payload);
      router.push(`/edu/assignments/${id}`);
    } catch (error) {
      // A 422 that names the deadline belongs under that field, next to the Close action.
      const fieldError = getFieldErrorCode(error, 'deadline');
      if (fieldError) {
        setDeadlineError(fieldError);
        return;
      }
      toast.error(translateErrorCode(tErrors, error instanceof ApiError ? error.code : null));
    }
  };

  const handleCloseNow = async () => {
    try {
      await closeMutation.mutateAsync(undefined);
      router.push(`/edu/assignments/${id}`);
    } catch (error) {
      toast.error(translateErrorCode(tErrors, error instanceof ApiError ? error.code : null));
    }
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

  // The same window the server decides on: published, opened, and not closed.
  const live =
    assignment.status === 'published' &&
    !assignment.closed_at &&
    (!assignment.start_time || new Date(assignment.start_time).getTime() <= Date.now());

  const initial: AssignmentFormValues = {
    title: assignment.title,
    description: assignment.description ?? '',
    deadline: assignment.deadline ? dbToDatetimeLocal(assignment.deadline) : '',
    timeLimitMin: assignment.time_limit_min?.toString() ?? '',
    shuffleQuestions: assignment.shuffle_questions,
    shuffleAnswers: assignment.shuffle_answers,
    showResults: assignment.show_results,
    maxAttempts: assignment.max_attempts.toString(),
    attemptItemCount: assignment.attempt_item_count?.toString() ?? '',
    allowSameItemRetake: assignment.allow_same_item_retake,
    unseenOnly: assignment.unseen_only,
    passingScore: assignment.passing_score?.toString() ?? '',
  };

  return (
    <AssignmentPage title={t('title')} subtitle={t('subtitle')}>
      <AssignmentForm
        mode="edit"
        initial={initial}
        isPending={updateMutation.isPending}
        live={live}
        deadlineError={deadlineError}
        onDeadlineChange={() => setDeadlineError(null)}
        onCloseNow={live ? () => void handleCloseNow() : undefined}
        closePending={closeMutation.isPending}
        onSubmit={(payload) => {
          void handleSubmit(payload);
        }}
        onCancel={() => router.back()}
      />
    </AssignmentPage>
  );
}
