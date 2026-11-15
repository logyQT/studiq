'use client';

import { toast } from 'sonner';
import { useApiMutation } from '@/hooks/use-api';
import { assignmentKeys } from '@/lib/query-keys';

export interface GradeAnswerPayload {
  attemptId: string;
  questionId: string;
  points: number;
  feedback: string;
}

export function useGradeAnswerMutation(assignmentId: string, errorMessage: string) {
  return useApiMutation<void, GradeAnswerPayload>({
    mutationFn: async ({ attemptId, questionId, points, feedback }) => {
      const res = await fetch(`/api/v1/teacher/assignments/${assignmentId}/results/${attemptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId, points, feedback }),
      });
      if (!res.ok) throw new Error(errorMessage);
    },
    invalidateKeys: assignmentKeys.gradingInvalidations(assignmentId),
    onError: () => {
      toast.error(errorMessage);
    },
  });
}
