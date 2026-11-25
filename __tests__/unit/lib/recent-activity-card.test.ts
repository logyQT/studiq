import type { StudentActivityItem } from '@studiq/server/models/student-overview.model';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecentActivityCard } from '@/components/app/dashboard/recent-activity-card';
import en from '@/i18n/messages/en.json';

vi.mock('@/lib/relative-time', () => ({ formatRelativeTime: () => 'relative time' }));

function render(item: StudentActivityItem) {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'en', messages: en, timeZone: 'UTC' },
      createElement(RecentActivityCard, { items: [item], isLoading: false }),
    ),
  );
}

const base: StudentActivityItem = {
  kind: 'quiz_completed',
  at: '2026-10-27T10:00:00Z',
  title: null,
  cardsStudied: null,
  scorePct: 80,
  attemptId: null,
  assignmentId: null,
  resultsWithheld: false,
};

const linkOf = (html: string) => /<a [^>]*href="([^"]*)"/.exec(html)?.[1]?.replaceAll('&amp;', '&');

describe('RecentActivityCard', () => {
  it('falls back to the neutral practice quiz copy for a quiz without a title', () => {
    expect(render(base)).toContain(en.AppDashboard.practice_quiz);
  });

  it('shows the quiz title when there is one', () => {
    const html = render({ ...base, title: 'Fizyka' });
    expect(html).toContain('Fizyka');
    expect(html).not.toContain(en.AppDashboard.practice_quiz);
  });

  it('uses the untitled assignment wording instead of the practice quiz fallback', () => {
    const html = render({ ...base, kind: 'assignment_submitted', scorePct: null });
    expect(html).toContain(en.AppDashboard.activity_assignment_submitted_untitled_no_score);
    expect(html).not.toContain(en.AppDashboard.practice_quiz);
  });

  const submitted: StudentActivityItem = {
    ...base,
    kind: 'assignment_submitted',
    title: 'Sprawdzian',
    attemptId: 'att-1',
    assignmentId: 'as-1',
  };

  it.each([
    ['a completed quiz', { ...base, attemptId: 'att-1' }, '/app/study/session/quiz/att-1/review'],
    ['visible results', submitted, '/app/assignments/as-1/review?attemptId=att-1'],
    [
      'withheld results',
      { ...submitted, scorePct: null, resultsWithheld: true },
      '/app/assignments/as-1',
    ],
  ])('links the line of %s', (_label, item, expected) => {
    expect(linkOf(render(item))).toBe(expected);
  });

  it('does not link the line of a deleted assignment', () => {
    const html = render({
      ...submitted,
      title: null,
      scorePct: null,
      assignmentId: null,
      resultsWithheld: true,
    });

    expect(html).toContain(en.AppDashboard.activity_assignment_submitted_untitled_no_score);
    expect(html).not.toContain('<a ');
  });
});
