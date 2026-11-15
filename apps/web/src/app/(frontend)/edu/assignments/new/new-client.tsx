'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { AssignmentForm, type AssignmentPayload } from '@/components/edu/assignment-form';
import { AssignmentPage } from '@/components/edu/assignment-page';
import { useApiMutation } from '@/hooks/use-api';
import { apiGet, apiPost } from '@/lib/api';
import { assignmentKeys } from '@/lib/query-keys';

export default function NewAssignmentClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const quizId = searchParams.get('quizId');
  const t = useTranslations('EduAssignmentNewPage');
  const [quizName, setQuizName] = useState('');
  // The form seeds its state once from the quiz, so it waits for a `quizId` lookup
  // rather than overwriting what the teacher has already typed.
  const [quizLoaded, setQuizLoaded] = useState(!quizId);

  useEffect(() => {
    if (!quizId) return;
    apiGet<{ id: string; name: string }>(`/api/v1/teacher/quizzes/${quizId}`)
      .then((quiz) => {
        setQuizName(quiz.name);
        return undefined;
      })
      .catch(() => {})
      .finally(() => setQuizLoaded(true));
  }, [quizId]);

  const createMutation = useApiMutation({
    mutationFn: async (body: AssignmentPayload & { quizId?: string }) =>
      apiPost<{ id: string }>('/api/v1/teacher/assignments', body),
    invalidateKeys: [assignmentKeys.all],
  });

  const handleSubmit = async (payload: AssignmentPayload) => {
    const data = await createMutation.mutateAsync({
      ...payload,
      quizId: quizId || undefined,
    });
    router.push(`/edu/assignments/${data.id}`);
  };

  return (
    <AssignmentPage title={t('title')} subtitle={t('subtitle')}>
      {quizLoaded && (
        <AssignmentForm
          mode="create"
          initial={quizName ? { title: quizName } : undefined}
          quizName={quizName}
          isPending={createMutation.isPending}
          onSubmit={(payload) => {
            void handleSubmit(payload);
          }}
          onCancel={() => router.back()}
        />
      )}
    </AssignmentPage>
  );
}
