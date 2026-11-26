import type { ResumeQuiz } from '@studiq/server/models/student-overview.model';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ContinueCard } from '@/components/app/dashboard/continue-card';
import en from '@/i18n/messages/en.json';

vi.mock('@/lib/relative-time', () => ({ formatRelativeTime: () => 'relative time' }));

function render(quiz: ResumeQuiz) {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'en', messages: en, timeZone: 'UTC' },
      createElement(ContinueCard, { quiz, deck: null, isLoading: false }),
    ),
  );
}

const base: ResumeQuiz = {
  attemptId: 'att-1',
  title: null,
  answered: 2,
  total: 10,
  startedAt: '2026-10-27T10:00:00Z',
};

describe('ContinueCard', () => {
  it('falls back to the neutral practice quiz copy when the quiz has no title', () => {
    expect(render(base)).toContain(en.AppDashboard.practice_quiz);
  });

  it('shows the quiz title when there is one', () => {
    const html = render({ ...base, title: 'Fizyka' });
    expect(html).toContain('Fizyka');
    expect(html).not.toContain(en.AppDashboard.practice_quiz);
  });
});
