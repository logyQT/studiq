'use client';

import type { StudentInsights } from '@studiq/server/models/student-insights.model';
import { useApiQuery } from '@/hooks/use-api';

/** Study time, topic mastery and retention of the signed-in student over the last `days` days. */
export function useStudentInsights(days: number) {
  return useApiQuery<StudentInsights>({
    queryKey: ['stats', 'student', 'insights', days],
    url: `/api/v1/stats/student/insights?days=${days}`,
    // Reviews and quizzes change these numbers all the time; look again after a minute.
    staleTime: 60_000,
  });
}
