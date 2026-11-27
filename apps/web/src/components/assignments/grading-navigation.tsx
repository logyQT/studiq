'use client';

import { Button } from '@studiq/ui';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type MouseEvent, useEffect } from 'react';
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

const POSITION_ID = 'grading-position';

/** Set by a move to another attempt; the sheet that mounts next takes the focus once. */
let sheetTitleWantsFocus = false;

/**
 * Ref of the sheet's heading. A move replaces the whole sheet, which would leave the focus on
 * `<body>` and say nothing to a screen reader. A first visit keeps the browser's own focus.
 */
export function focusSheetTitle(heading: HTMLHeadingElement | null): void {
  if (!heading || !sheetTitleWantsFocus) return;
  sheetTitleWantsFocus = false;
  heading.focus();
}

/** The heading names the position as its description, so the focus announces both. */
export const SHEET_TITLE_DESCRIPTION_ID = POSITION_ID;

/** A click that opens a new tab leaves this sheet in place, so it asks for no focus. */
function onMove(event: MouseEvent): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
  sheetTitleWantsFocus = true;
}

function useAttemptNavigation(assignmentId: string, attemptId: string) {
  // The results table's own query: the same order, and a saved grade refreshes it. A student
  // can submit while the teacher grades, so every opened sheet reads the list again.
  const { data, isFetching } = useApiQuery<{ attempts: NavigableAttempt[] }>({
    queryKey: assignmentKeys.results(assignmentId),
    url: `/api/v1/teacher/assignments/${assignmentId}/results`,
    staleTime: 0,
  });
  return {
    navigation: data ? attemptNavigation(data.attempts, attemptId) : null,
    isFetching,
  };
}

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
  const { navigation, isFetching } = useAttemptNavigation(assignmentId, attemptId);

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
      sheetTitleWantsFocus = true;
      router.push(`/edu/assignments/${assignmentId}/results/${target}`);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [assignmentId, previousId, nextId, nextUngradedId, router]);

  if (!navigation) return null;

  const hrefOf = (id: string) => `/edu/assignments/${assignmentId}/results/${id}`;

  return (
    <nav aria-label={t('navigation')} className="flex flex-wrap items-center gap-2">
      <p id={POSITION_ID} className="mr-auto text-sm text-muted-foreground">
        {/* With nothing left, the sentence below says it: no „0 left” next to it. */}
        {t(navigation.leftToGrade > 0 ? 'position' : 'position_done', {
          position: navigation.position,
          total: navigation.total,
          left: navigation.leftToGrade,
        })}
      </p>
      {previousId && (
        <Button asChild variant="outline" size="sm">
          <Link onClick={onMove} href={hrefOf(previousId)}>
            <ArrowLeft className="w-3 h-3 mr-1" />
            {t('previous_attempt')}
          </Link>
        </Button>
      )}
      {nextId && (
        <Button asChild variant="outline" size="sm">
          <Link onClick={onMove} href={hrefOf(nextId)}>
            {t('next_attempt')}
            <ArrowRight className="w-3 h-3 ml-1" />
          </Link>
        </Button>
      )}
      {nextUngradedId && (
        <Button asChild size="sm">
          <Link onClick={onMove} href={hrefOf(nextUngradedId)}>
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
export function GradingShortcutsPanel({
  assignmentId,
  attemptId,
}: {
  assignmentId: string;
  attemptId: string;
}) {
  const t = useTranslations('EduGradingPage');
  const { navigation } = useAttemptNavigation(assignmentId, attemptId);
  // With nowhere to go, no key does anything: nothing to list.
  if (!navigation?.previousId && !navigation?.nextId) return null;

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
