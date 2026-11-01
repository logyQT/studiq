import type {
  ProblematicQuestionStats,
  TeacherFeedItem,
  TeacherGroupPerformance,
} from '@studiq/server/models/stats.model';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActivityFeedCard } from '@/components/edu/dashboard/activity-feed-card';
import { GroupPerformanceCard } from '@/components/edu/dashboard/group-performance-card';
import { ProblemQuestionsCard } from '@/components/edu/dashboard/problem-questions-card';
import pl from '@/i18n/messages/pl.json';

const locale = 'pl';
/** The app's default locale (AGENTS.md), so the rendered copy and the assertions agree. */
const t = createTranslator({ locale, messages: pl, namespace: 'EduOverviewPage' });

// Recharts needs browser layout; expose the chart's input so the filtering can be checked in Node.
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('recharts')>()),
  BarChart: ({ data }: { data: { groupName: string }[] }) =>
    createElement('div', { 'data-chart': data.map((group) => group.groupName).join(',') }),
  Bar: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
vi.mock('@studiq/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@studiq/ui')>();
  return {
    ...original,
    ChartContainer: ({ children }: { children: ReactNode }) => createElement('div', null, children),
    ChartTooltipContent: () => null,
  };
});
vi.mock('@/lib/relative-time', () => ({ formatRelativeTime: () => 'relative time' }));

const idle = { isLoading: false, isError: false, onRetry: () => {} };
function render(element: ReactNode) {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: pl, timeZone: 'UTC' }, element),
  );
}

describe('teacher dashboard cards', () => {
  it('shows no-data values separately from zero scores and excludes only null scores from the chart', () => {
    const data: TeacherGroupPerformance = {
      groups: [
        {
          groupId: '1',
          groupName: 'No scores',
          students: 1,
          completedAttempts: 0,
          awaitingGrade: 0,
          avgScore: null,
          flashcardReviews: 0,
          flashcardAccuracy: null,
        },
        {
          groupId: '2',
          groupName: 'Zero scores',
          students: 2,
          completedAttempts: 1,
          awaitingGrade: 1,
          avgScore: 0,
          flashcardReviews: 1,
          flashcardAccuracy: 0,
        },
      ],
      totals: { students: 3, completedAttempts: 1, awaitingGrade: 1 },
    };
    const html = render(createElement(GroupPerformanceCard, { ...idle, data, days: 30 }));

    expect(html).toContain('data-chart="Zero scores"');
    expect(html.split(t('no_data')).length - 1).toBe(2);
    expect(html.match(/0%/g)).toHaveLength(2);
    expect(html).toContain(t('awaiting_grade', { count: 1 }));
    expect(html).toContain('No scores');
  });

  it('renders the empty group and no-score states independently', () => {
    const totals = { students: 0, completedAttempts: 0, awaitingGrade: 0 };
    const empty = render(
      createElement(GroupPerformanceCard, { ...idle, data: { groups: [], totals }, days: 30 }),
    );
    expect(empty).toContain(t('no_groups'));
    const noScores = render(
      createElement(GroupPerformanceCard, {
        ...idle,
        days: 30,
        data: {
          totals,
          groups: [
            {
              groupId: '1',
              groupName: 'Class',
              students: 0,
              completedAttempts: 0,
              awaitingGrade: 0,
              avgScore: null,
              flashcardReviews: 0,
              flashcardAccuracy: null,
            },
          ],
        },
      }),
    );
    expect(noScores).toContain(t('no_group_data', { days: 30 }));
    expect(noScores).toContain('Class');
    expect(noScores).not.toContain('data-chart=');
  });

  it('links assignments and reports, keeps quizzes unlinked, and handles missing titles and names', () => {
    const base = {
      at: '2026-10-28T10:00:00Z',
      scorePct: 0,
      needsGrading: false,
      assignmentId: null,
      questionId: null,
    };
    const items: TeacherFeedItem[] = [
      { ...base, kind: 'quiz_completed', title: null, personName: null },
      {
        ...base,
        kind: 'assignment_submitted',
        title: 'Homework',
        personName: 'Ada',
        assignmentId: 'a1',
        needsGrading: true,
      },
      { ...base, kind: 'report_opened', title: null, personName: 'Ben' },
      { ...base, kind: 'assignment_submitted', title: null, personName: 'Cleo' },
    ];
    const html = render(createElement(ActivityFeedCard, { ...idle, items }));

    expect(html).toContain('href="/edu/assignments/a1/results"');
    expect(html).toContain('href="/edu/reports"');
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain(t('feed_needs_grading'));
    expect(html).toContain(t('feed_quiz_completed_plain', { name: t('unknown_person'), score: 0 }));
    expect(html).toContain('0%');
    expect(html).toContain('relative time');
    expect(html).not.toContain('„”');
  });

  it('filters low answer counts before selecting five questions and rounds their rates', () => {
    const question = (id: string, totalAnswers: number): ProblematicQuestionStats => ({
      id,
      content: `Question ${id}`,
      type: 'mcq',
      totalAnswers,
      correctRate: 0.126,
    });
    const questions = [
      question('too-few', 2),
      ...Array.from({ length: 6 }, (_, i) => question(String(i + 1), 3)),
    ];
    const html = render(createElement(ProblemQuestionsCard, { ...idle, questions }));

    expect(html).not.toContain('Question too-few');
    expect(html).toContain('Question 1');
    expect(html).toContain('Question 5');
    expect(html).not.toContain('Question 6');
    expect(html).toContain('13%');
    expect(html).toContain(t('problem_answers', { count: 3 }));
    expect(html).toContain('href="/edu/stats/results"');
  });

  it('shows empty feed and question states when no items qualify', () => {
    const feed = render(createElement(ActivityFeedCard, { ...idle, items: [] }));
    const questions = render(
      createElement(ProblemQuestionsCard, {
        ...idle,
        questions: [
          { id: 'q', content: 'Too few answers', type: 'mcq', totalAnswers: 2, correctRate: 0 },
        ],
      }),
    );

    expect(feed).toContain(t('feed_empty'));
    expect(questions).toContain(t('problem_empty'));
    expect(questions).not.toContain('Too few answers');
  });

  it.each(['groups', 'feed', 'questions'] as const)(
    '%s keeps loading ahead of the error and empty states',
    (card) => {
      const state = { ...idle, isLoading: true, isError: true };
      const element =
        card === 'groups'
          ? createElement(GroupPerformanceCard, { ...state, data: undefined, days: 30 })
          : card === 'feed'
            ? createElement(ActivityFeedCard, { ...state, items: [] })
            : createElement(ProblemQuestionsCard, { ...state, questions: [] });
      const html = render(element);
      expect(html).toContain('animate-pulse');
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain(t('feed_empty'));
      expect(html).not.toContain(t('problem_empty'));
      expect(html).not.toContain(t('no_groups'));
    },
  );

  it.each(['groups', 'feed', 'questions'] as const)(
    '%s shows an error instead of an empty state',
    (card) => {
      const state = { ...idle, isError: true };
      const element =
        card === 'groups'
          ? createElement(GroupPerformanceCard, { ...state, data: undefined, days: 30 })
          : card === 'feed'
            ? createElement(ActivityFeedCard, { ...state, items: [] })
            : createElement(ProblemQuestionsCard, { ...state, questions: [] });
      const html = render(element);
      expect(html).toContain('role="alert"');
      expect(html).toContain(t('retry'));
      expect(html).not.toContain(t('feed_empty'));
      expect(html).not.toContain(t('problem_empty'));
      expect(html).not.toContain(t('no_groups'));
    },
  );
});
