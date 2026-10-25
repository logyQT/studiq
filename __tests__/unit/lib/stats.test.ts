import { describe, expect, it } from 'vitest';
import { hasTeacherActivity, summarizeWeeklyActivity, weeklyWindowStart } from '@/lib/stats';

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
