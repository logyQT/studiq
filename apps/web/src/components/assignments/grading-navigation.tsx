'use client';

import { Button } from '@studiq/ui';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { KeyboardShortcutsPanel } from '@/components/shared/keyboard-shortcuts-panel';
import { useApiQuery } from '@/hooks/use-api';
import {
  attemptNavigation,
  GRADING_SHORTCUT_KEYS,
  gradingShortcut,
  type NavigableAttempt,
} from '@/lib/grading-navigation';
import { assignmentKeys } from '@/lib/query-keys';
import { isIgnorableKeyEvent, isTypingTarget, overlayOpen } from '@/lib/shortcuts';

/** Moves between the attempts of one assignment without going back to the results (#1354). */
export function GradingNavigation({
  assignmentId,
  attemptId,
}: {
  assignmentId: string;
  attemptId: string;
}) {
  const t = useTranslations('EduGradingPage');
  const router = useRouter();

  // The results table's own query: the same order, and a saved grade refreshes it. A student
  // can submit while the teacher grades, so every opened sheet reads the list again.
  const { data, isFetching } = useApiQuery<{ attempts: NavigableAttempt[] }>({
    queryKey: assignmentKeys.results(assignmentId),
    url: `/api/v1/teacher/assignments/${assignmentId}/results`,
    staleTime: 0,
  });
  const navigation = data ? attemptNavigation(data.attempts, attemptId) : null;

  const previousId = navigation?.previousId ?? null;
  const nextId = navigation?.nextId ?? null;
  const nextUngradedId = navigation?.nextUngradedId ?? null;

  useEffect(() => {
    const targets = { previous: previousId, next: nextId, nextUngraded: nextUngradedId };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isIgnorableKeyEvent(event) || isTypingTarget(document.activeElement) || overlayOpen()) {
        return;
      }
      const shortcut = gradingShortcut(event.key);
      const target = shortcut ? targets[shortcut] : null;
      if (!target) return;
      event.preventDefault();
      router.push(`/edu/assignments/${assignmentId}/results/${target}`);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [assignmentId, previousId, nextId, nextUngradedId, router]);

  if (!navigation) return null;

  const hrefOf = (id: string) => `/edu/assignments/${assignmentId}/results/${id}`;

  return (
    <nav aria-label={t('navigation')} className="flex flex-wrap items-center gap-2">
      <p className="mr-auto text-sm text-muted-foreground">
        {t('position', {
          position: navigation.position,
          total: navigation.total,
          left: navigation.leftToGrade,
        })}
      </p>
      {previousId && (
        <Button asChild variant="outline" size="sm">
          <Link href={hrefOf(previousId)}>
            <ArrowLeft className="w-3 h-3 mr-1" />
            {t('previous_attempt')}
          </Link>
        </Button>
      )}
      {nextId && (
        <Button asChild variant="outline" size="sm">
          <Link href={hrefOf(nextId)}>
            {t('next_attempt')}
            <ArrowRight className="w-3 h-3 ml-1" />
          </Link>
        </Button>
      )}
      {nextUngradedId && (
        <Button asChild size="sm">
          <Link href={hrefOf(nextUngradedId)}>
            {t('next_ungraded')}
            <ArrowRight className="w-3 h-3 ml-1" />
          </Link>
        </Button>
      )}
      {/* Not from a list that is still being read: it can lack a new submission. */}
      {navigation.leftToGrade === 0 && !isFetching && (
        <p className="text-sm font-medium">
          {t('all_graded')}{' '}
          <Link
            href={`/edu/assignments/${assignmentId}/results`}
            className="text-primary hover:underline"
          >
            {t('view_results')}
          </Link>
        </p>
      )}
    </nav>
  );
}

/** The keys of the grading page. The panel sticks to the bottom, so it goes last on the page. */
export function GradingShortcutsPanel() {
  const t = useTranslations('EduGradingPage');

  return (
    <KeyboardShortcutsPanel
      shortcuts={[
        { key: GRADING_SHORTCUT_KEYS.previous, label: t('previous_attempt') },
        { key: GRADING_SHORTCUT_KEYS.next, label: t('next_attempt') },
        { key: GRADING_SHORTCUT_KEYS.nextUngraded, label: t('next_ungraded') },
      ]}
    />
  );
}
