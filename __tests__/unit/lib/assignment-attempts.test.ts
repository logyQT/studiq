import { describe, expect, it } from 'vitest';
import {
  type AttemptSummary,
  attemptsLeft,
  hasAttemptsLeft,
  openAttempt,
  reviewAttemptId,
  type StudentAssignmentAttemptState,
} from '@/lib/assignment-attempts';

function attempt(overrides: Partial<AttemptSummary> = {}): AttemptSummary {
  return {
    id: 'attempt-1',
    score: 2,
    total_questions: 2,
    total_points: 2,
    completed_at: '2026-07-13T01:00:00Z',
    started_at: '2026-07-13T00:00:00Z',
    ...overrides,
  };
}

function state(
  overrides: Partial<StudentAssignmentAttemptState> = {},
): StudentAssignmentAttemptState {
  return {
    max_attempts: 2,
    attempts_used: 0,
    attempt: null,
    last_completed_attempt: null,
    ...overrides,
  };
}

describe('assignment attempt helpers (#372)', () => {
  it('reports the full budget when nothing was attempted', () => {
    const s = state();
    expect(openAttempt(s)).toBeNull();
    expect(attemptsLeft(s)).toBe(2);
    expect(hasAttemptsLeft(s)).toBe(true);
  });

  it('reports one attempt left after the first of two was submitted', () => {
    const completed = attempt();
    const s = state({ attempts_used: 1, attempt: completed, last_completed_attempt: completed });
    expect(openAttempt(s)).toBeNull();
    expect(attemptsLeft(s)).toBe(1);
    expect(hasAttemptsLeft(s)).toBe(true);
  });

  it('reports an exhausted budget after the last allowed attempt', () => {
    const completed = attempt();
    const s = state({ attempts_used: 2, attempt: completed, last_completed_attempt: completed });
    expect(attemptsLeft(s)).toBe(0);
    expect(hasAttemptsLeft(s)).toBe(false);
  });

  it('clamps the budget at zero when a teacher lowered max_attempts below the used count', () => {
    const s = state({ max_attempts: 1, attempts_used: 3 });
    expect(attemptsLeft(s)).toBe(0);
    expect(hasAttemptsLeft(s)).toBe(false);
  });

  it('treats a running attempt as open and not counted', () => {
    const completed = attempt();
    const running = attempt({
      id: 'attempt-2',
      started_at: '2026-07-13T02:00:00Z',
      completed_at: null,
    });
    const s = state({
      attempts_used: 1,
      attempt: running,
      last_completed_attempt: completed,
    });
    expect(openAttempt(s)?.id).toBe('attempt-2');
    expect(attemptsLeft(s)).toBe(1);
  });

  it('does not treat a completed attempt as open', () => {
    const completed = attempt();
    expect(openAttempt(state({ attempt: completed, attempts_used: 1 }))).toBeNull();
  });
});

describe('reviewAttemptId (#175)', () => {
  it('prefers an explicit attempt id so older attempts stay linkable', () => {
    const completed = attempt({ id: 'attempt-latest' });
    const s = state({ last_completed_attempt: completed });
    expect(reviewAttemptId('attempt-older', s)).toBe('attempt-older');
  });

  it('falls back to the latest completed attempt when no id is requested', () => {
    const completed = attempt({ id: 'attempt-latest' });
    const s = state({ last_completed_attempt: completed });
    expect(reviewAttemptId(null, s)).toBe('attempt-latest');
  });

  it('falls back when the query param is an empty string', () => {
    const completed = attempt({ id: 'attempt-latest' });
    const s = state({ last_completed_attempt: completed });
    expect(reviewAttemptId('', s)).toBe('attempt-latest');
  });

  it('returns null when nothing was completed and no id was requested', () => {
    const s = state({ attempt: attempt({ completed_at: null }) });
    expect(reviewAttemptId(undefined, s)).toBeNull();
  });

  it('returns null when the assignment is not loaded yet', () => {
    expect(reviewAttemptId(null, undefined)).toBeNull();
    expect(reviewAttemptId(null, null)).toBeNull();
  });
});
