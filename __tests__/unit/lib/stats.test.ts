import { describe, expect, it } from 'vitest';
import { summarizeWeeklyActivity, weeklyWindowStart } from '@/lib/stats';

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
