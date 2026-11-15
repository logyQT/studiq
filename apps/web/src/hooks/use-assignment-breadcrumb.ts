'use client';

import { useApiQuery } from '@/hooks/use-api';
import { useBreadcrumbLabel } from '@/hooks/use-breadcrumbs';
import { assignmentKeys } from '@/lib/query-keys';

export function useAssignmentBreadcrumb(assignmentId: string) {
  // Same query key as the detail page, so in-app navigation is a cache hit.
  const { data: assignment } = useApiQuery<{ title: string }>({
    queryKey: assignmentKeys.detail(assignmentId),
    url: `/api/v1/teacher/assignments/${assignmentId}`,
  });

  // The assignment title is the breadcrumb label; the raw UUID must never render.
  useBreadcrumbLabel(assignmentId, assignment?.title);
}
