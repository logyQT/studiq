import type { ProblematicQuestionStats } from '@studiq/server/models/stats.model';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import { problemQuestionHref } from '@/lib/problem-question-link';
import { cn } from '@/lib/utils';

/** A problem-question row as a link to the question in its bank, on every teacher screen. */
export function ProblemQuestionLink({
  question,
  className,
  children,
}: {
  question: Pick<ProblematicQuestionStats, 'bankId' | 'content'>;
  className: string;
  children: ReactNode;
}) {
  return (
    <Link href={problemQuestionHref(question)} className={cn(className, FOCUS_RING)}>
      {children}
    </Link>
  );
}
