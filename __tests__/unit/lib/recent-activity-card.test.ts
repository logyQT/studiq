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
};

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
});
