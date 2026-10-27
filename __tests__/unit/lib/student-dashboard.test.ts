import { describe, expect, it } from 'vitest';
import { dueProgress } from '@/lib/due-progress';
import { upcomingAssignments } from '@/lib/upcoming-assignments';

// #655: the personalised student dashboard. Its two pure parts are the progress of today's
// reviews and the list of assignments the student can still do.

describe('dueProgress', () => {
  it('counts what is done against what is done plus still due', () => {
    expect(dueProgress(6, 14)).toEqual({ done: 6, remaining: 14, total: 20, percent: 30 });
  });

  it('is complete when nothing is left but something was reviewed', () => {
    expect(dueProgress(12, 0)).toEqual({ done: 12, remaining: 0, total: 12, percent: 100 });
  });

  it('has no bar when there is nothing to do and nothing done', () => {
    expect(dueProgress(0, 0)).toEqual({ done: 0, remaining: 0, total: 0, percent: 0 });
  });

  it('starts at 0 % when only due cards exist', () => {
    expect(dueProgress(0, 5).percent).toBe(0);
  });

  it('rounds to a whole percent', () => {
    expect(dueProgress(1, 2).percent).toBe(33);
    expect(dueProgress(2, 1).percent).toBe(67);
  });

  it('clamps negative and fractional input from a stale cache', () => {
    expect(dueProgress(-3, 2.9)).toEqual({ done: 0, remaining: 2, total: 2, percent: 0 });
  });
});

const NOW = new Date('2026-10-27T12:00:00Z');
const attempt = (completedAt: string | null) => ({
  id: 'a',
  score: null,
  total_questions: 5,
  total_points: 5,
  started_at: '2026-10-26T10:00:00Z',
  completed_at: completedAt,
});

function assignment(
  id: string,
  over: Partial<{
    deadline: string | null;
    start_time: string | null;
    max_attempts: number;
    attempts_used: number;
    open: boolean;
  }> = {},
) {
  const { open = false, ...rest } = over;
  return {
    id,
    title: id,
    start_time: null,
    deadline: null,
    max_attempts: 1,
    attempts_used: 0,
    attempt: open ? attempt(null) : null,
    last_completed_attempt: null,
    ...rest,
  };
}

describe('upcomingAssignments', () => {
  it('orders by deadline, soonest first, with undated ones last', () => {
    const list = upcomingAssignments(
      [
        assignment('later', { deadline: '2026-11-10T12:00:00Z' }),
        assignment('undated'),
        assignment('soon', { deadline: '2026-10-28T12:00:00Z' }),
      ],
      NOW,
    );
    expect(list.map((a) => a.id)).toEqual(['soon', 'later', 'undated']);
  });

  it('marks assignments with a running attempt', () => {
    const list = upcomingAssignments(
      [assignment('running', { open: true }), assignment('fresh')],
      NOW,
    );
    expect(list.find((a) => a.id === 'running')?.inProgress).toBe(true);
    expect(list.find((a) => a.id === 'fresh')?.inProgress).toBe(false);
  });

  it('leaves out scheduled, closed and finished assignments', () => {
    const list = upcomingAssignments(
      [
        assignment('scheduled', { start_time: '2026-11-01T00:00:00Z' }),
        assignment('closed', { deadline: '2026-10-01T00:00:00Z' }),
        assignment('finished', { attempts_used: 1 }),
        assignment('open', { deadline: '2026-11-02T00:00:00Z' }),
      ],
      NOW,
    );
    expect(list.map((a) => a.id)).toEqual(['open']);
  });

  it('keeps assignments with attempts left after a completed one', () => {
    const list = upcomingAssignments(
      [assignment('again', { max_attempts: 3, attempts_used: 1 })],
      NOW,
    );
    expect(list.map((a) => a.id)).toEqual(['again']);
  });

  it('shows at most the requested number', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      assignment(`a${i}`, { deadline: `2026-11-0${i + 1}T00:00:00Z` }),
    );
    expect(upcomingAssignments(many, NOW, 3).map((a) => a.id)).toEqual(['a0', 'a1', 'a2']);
    expect(upcomingAssignments(many, NOW)).toHaveLength(4);
  });
});
