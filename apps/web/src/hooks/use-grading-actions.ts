'use client';

import { useApiQuery } from '@/hooks/use-api';
import { useAssignmentBreadcrumb } from '@/hooks/use-assignment-breadcrumb';
import { useGradeAnswerMutation } from '@/hooks/use-grade-mutation';
import { assignmentKeys } from '@/lib/query-keys';

export function usePerQuestionGrading<T>(assignmentId: string, errorMessage: string) {
  useAssignmentBreadcrumb(assignmentId);

  const resultsQuery = useApiQuery<{ attempts: T[]; auto_graded_item_ids?: string[] }>({
    queryKey: assignmentKeys.results(assignmentId),
    url: `/api/v1/teacher/assignments/${assignmentId}/results`,
  });

  const gradeMutation = useGradeAnswerMutation(assignmentId, errorMessage);

  return {
    resultsQuery,
    attempts: resultsQuery.data?.attempts,
    autoGradedItemIds: resultsQuery.data?.auto_graded_item_ids ?? [],
    gradeMutation,
  };
}
