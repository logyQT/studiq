import { describe, expect, it } from 'vitest';
import {
  attemptPercentage,
  hasTeacherActivity,
  orderedQuestionTypeEntries,
  parseTeacherStatsResponse,
  summarizeWeeklyActivity,
  weeklyWindowStart,
} from '@/lib/stats';

// Fixed clock so the window arithmetic is deterministic (2026-10-23 12:00 UTC).
const NOW = Date.parse('2026-10-23T12:00:00Z');
const day = (offset: number) => new Date(NOW - offset * 86_400_000).toISOString().slice(0, 10);

const row = (offset: number, reviews: number, correct: number) => ({
  date: day(offset),
  reviews_count: reviews,
  reviews_correct: correct,
  quizzes_count: 0,
  quizzes_score: 0,
  quizzes_total: 0,
});

describe('summarizeWeeklyActivity (#383)', () => {
  it('returns the same last-7-days counters for every chart range payload', () => {
    const week = [row(0, 5, 4)];
    const month = [...week, row(13, 8, 6)];
    const year = [...month, row(52, 20, 15), row(342, 3, 2)];

    expect(summarizeWeeklyActivity(week, NOW)).toEqual({ reviews: 5, correct: 4 });
    expect(summarizeWeeklyActivity(month, NOW)).toEqual({ reviews: 5, correct: 4 });
    expect(summarizeWeeklyActivity(year, NOW)).toEqual({ reviews: 5, correct: 4 });
  });

  it('includes the 7th day back and excludes the 8th', () => {
    const items = [row(7, 2, 1), row(8, 20, 20)];

    expect(summarizeWeeklyActivity(items, NOW)).toEqual({ reviews: 2, correct: 1 });
  });

  it('handles an empty or missing payload', () => {
    expect(summarizeWeeklyActivity([], NOW)).toEqual({ reviews: 0, correct: 0 });
    expect(summarizeWeeklyActivity(undefined, NOW)).toEqual({ reviews: 0, correct: 0 });
    expect(summarizeWeeklyActivity(null, NOW)).toEqual({ reviews: 0, correct: 0 });
  });
});

describe('weeklyWindowStart (#383)', () => {
  it('matches the server rolling range=7d boundary (UTC date)', () => {
    expect(weeklyWindowStart(NOW)).toBe('2026-10-16');
  });
});

describe('attemptPercentage (#321)', () => {
  it('scores a practice attempt against the question count', () => {
    expect(attemptPercentage({ score: 3, total_questions: 4, total_points: null })).toBe(75);
  });

  it('scores an assignment attempt against total_points', () => {
    expect(attemptPercentage({ score: 3, total_questions: 4, total_points: 5 })).toBe(60);
  });

  it('falls back to the question count when total_points is missing', () => {
    expect(attemptPercentage({ score: 2, total_questions: 3 })).toBe(67);
  });

  it('never divides by zero', () => {
    expect(attemptPercentage({ score: 0, total_questions: 0, total_points: null })).toBe(0);
    expect(attemptPercentage({ score: 0, total_questions: 0 })).toBe(0);
  });

  it('rounds to the nearest integer', () => {
    expect(attemptPercentage({ score: 1, total_questions: 3 })).toBe(33);
    expect(attemptPercentage({ score: 2, total_questions: 3 })).toBe(67);
  });
});

describe('hasTeacherActivity (#209)', () => {
  const empty = () => ({
    summary: {
      activeStudents: { current: 0 },
      totalPractices: { current: 0 },
      totalQuizzes: { current: 0 },
    },
    dailyActivity: [
      { reviews: 0, activeStudents: 0 },
      { reviews: 0, activeStudents: 0 },
    ],
    students: [{ practices7d: 0, quizzes7d: 0 }],
  });
  type Data = ReturnType<typeof empty>;

  it('is false when every counter is zero', () => {
    expect(hasTeacherActivity(empty())).toBe(false);
  });

  it('ignores activeStudents: AI-token-only rows in user_daily_activity are not learning activity', () => {
    const data = empty();
    data.summary.activeStudents.current = 3;
    data.dailyActivity[0].activeStudents = 3;
    data.dailyActivity[1].activeStudents = 2;
    expect(hasTeacherActivity(data)).toBe(false);
  });

  it.each([
    ['summary.totalPractices', (d: Data) => (d.summary.totalPractices.current = 1)],
    ['summary.totalQuizzes', (d: Data) => (d.summary.totalQuizzes.current = 1)],
    ['chart reviews', (d: Data) => (d.dailyActivity[1].reviews = 1)],
    ['student practices', (d: Data) => (d.students[0].practices7d = 1)],
    ['student quizzes', (d: Data) => (d.students[0].quizzes7d = 1)],
  ])('is true when only %s is non-zero', (_name, mutate) => {
    const data = empty();
    mutate(data);
    expect(hasTeacherActivity(data)).toBe(true);
  });
});

describe('orderedQuestionTypeEntries (#200)', () => {
  it('keeps the product order regardless of object key order', () => {
    expect(orderedQuestionTypeEntries({ open: 3, true_false: 2, mcq: 4 })).toEqual([
      { key: 'mcq', count: 4 },
      { key: 'true_false', count: 2 },
      { key: 'open', count: 3 },
    ]);
  });

  it('appends unknown types alphabetically after the known ones', () => {
    expect(orderedQuestionTypeEntries({ multi_select: 3, mcq: 2, matching: 1 })).toEqual([
      { key: 'mcq', count: 2 },
      { key: 'matching', count: 1 },
      { key: 'multi_select', count: 3 },
    ]);
  });

  it('keeps zero counts and returns an empty list for an empty record', () => {
    expect(orderedQuestionTypeEntries({ open: 0 })).toEqual([{ key: 'open', count: 0 }]);
    expect(orderedQuestionTypeEntries({})).toEqual([]);
  });
});

const validTeacherStats = {
  totalQuestions: 10,
  totalFlashcards: 8,
  subject: { byType: { mcq: 4, true_false: 3, open: 3 } },
  bySubject: [{ subjectId: 'bank-his', subjectName: 'Historia', questionCount: 4 }],
};

describe('parseTeacherStatsResponse (#200)', () => {
  it('unwraps a successful envelope', () => {
    expect(parseTeacherStatsResponse({ success: true, data: validTeacherStats })).toEqual(
      validTeacherStats,
    );
  });

  it('accepts a raw payload, preserving the pre-envelope behaviour', () => {
    expect(parseTeacherStatsResponse(validTeacherStats)).toEqual(validTeacherStats);
  });

  it('rejects an error envelope instead of putting it in state', () => {
    expect(
      parseTeacherStatsResponse({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      }),
    ).toBeNull();
  });

  it('rejects a payload without subject.byType', () => {
    expect(
      parseTeacherStatsResponse({
        success: true,
        data: { totalQuestions: 10, totalFlashcards: 8 },
      }),
    ).toBeNull();
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'oops'],
    ['an empty object', {}],
    ['an empty data array', { success: true, data: [] }],
    ['a null data field', { success: true, data: null }],
  ])('rejects %s', (_name, body) => {
    expect(parseTeacherStatsResponse(body)).toBeNull();
  });
});
