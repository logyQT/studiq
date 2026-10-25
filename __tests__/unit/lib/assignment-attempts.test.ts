import { describe, expect, it } from 'vitest';
import {
  type AttemptSummary,
  attemptsLeft,
  groupStudentAssignments,
  hasAttemptsLeft,
  openAttempt,
  reviewAttemptId,
  type StudentAssignmentAttemptState,
  type StudentAssignmentTiming,
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

describe('groupStudentAssignments (#368)', () => {
  const now = new Date('2026-07-13T12:00:00Z');
  const future = '2026-07-20T12:00:00Z';
  const past = '2026-07-01T12:00:00Z';

  type TestAssignment = StudentAssignmentAttemptState & StudentAssignmentTiming & { id: string };

  function row(overrides: Partial<TestAssignment> = {}): TestAssignment {
    return {
      id: 'assignment-1',
      start_time: past,
      deadline: future,
      ...state(),
      ...overrides,
    };
  }

  const running = attempt({
    id: 'attempt-running',
    started_at: '2026-07-13T11:00:00Z',
    completed_at: null,
  });

  it('keeps a not-started assignment pending', () => {
    const buckets = groupStudentAssignments([row()], now);
    expect(buckets.pending).toHaveLength(1);
    expect(buckets.inProgress).toHaveLength(0);
    expect(buckets.scheduled).toHaveLength(0);
    expect(buckets.closed).toHaveLength(0);
    expect(buckets.completed).toHaveLength(0);
  });

  it('moves a started assignment out of pending into inProgress', () => {
    // The reported bug: `attempts_used` only counts completed attempts, so an
    // open attempt used to satisfy the pending filter and inflate its counter.
    const buckets = groupStudentAssignments([row({ attempt: running })], now);
    expect(buckets.inProgress.map((a) => a.id)).toEqual(['assignment-1']);
    expect(buckets.pending).toHaveLength(0);
  });

  it('groups a retake that is running after one submitted attempt as inProgress', () => {
    const completed = attempt();
    const buckets = groupStudentAssignments(
      [
        row({
          attempts_used: 1,
          attempt: running,
          last_completed_attempt: completed,
        }),
      ],
      now,
    );
    expect(buckets.inProgress).toHaveLength(1);
    expect(buckets.pending).toHaveLength(0);
    expect(buckets.completed).toHaveLength(0);
  });

  it('keeps a submitted assignment with attempts left pending when nothing is running', () => {
    const completed = attempt();
    const buckets = groupStudentAssignments(
      [row({ attempts_used: 1, attempt: completed, last_completed_attempt: completed })],
      now,
    );
    expect(buckets.pending).toHaveLength(1);
    expect(buckets.inProgress).toHaveLength(0);
  });

  it('groups an exhausted budget as completed even if an attempt looks open', () => {
    const completed = attempt();
    const buckets = groupStudentAssignments(
      [
        row({
          max_attempts: 1,
          attempts_used: 1,
          attempt: running,
          last_completed_attempt: completed,
        }),
      ],
      now,
    );
    expect(buckets.completed).toHaveLength(1);
    expect(buckets.inProgress).toHaveLength(0);
    expect(buckets.pending).toHaveLength(0);
  });

  it('groups an assignment that has not opened yet as scheduled', () => {
    const buckets = groupStudentAssignments([row({ start_time: future })], now);
    expect(buckets.scheduled).toHaveLength(1);
    expect(buckets.pending).toHaveLength(0);
    expect(buckets.inProgress).toHaveLength(0);
  });

  it('groups an assignment past its deadline as closed', () => {
    const buckets = groupStudentAssignments([row({ deadline: past })], now);
    expect(buckets.closed).toHaveLength(1);
    expect(buckets.inProgress).toHaveLength(0);
    expect(buckets.pending).toHaveLength(0);
  });

  it('keeps an open attempt past the deadline closed, since it cannot be resumed', () => {
    const buckets = groupStudentAssignments([row({ deadline: past, attempt: running })], now);
    expect(buckets.closed).toHaveLength(1);
    expect(buckets.inProgress).toHaveLength(0);
  });

  it('puts every row in exactly one bucket and preserves input order', () => {
    const rows = [
      row({ id: 'pending-1' }),
      row({ id: 'in-progress-1', attempt: running }),
      row({ id: 'pending-2' }),
      row({ id: 'scheduled-1', start_time: future }),
      row({ id: 'closed-1', deadline: past }),
      row({
        id: 'completed-1',
        attempts_used: 2,
        attempt: attempt(),
        last_completed_attempt: attempt(),
      }),
    ];

    const buckets = groupStudentAssignments(rows, now);

    expect(buckets.pending.map((a) => a.id)).toEqual(['pending-1', 'pending-2']);
    expect(buckets.inProgress.map((a) => a.id)).toEqual(['in-progress-1']);
    expect(buckets.scheduled.map((a) => a.id)).toEqual(['scheduled-1']);
    expect(buckets.closed.map((a) => a.id)).toEqual(['closed-1']);
    expect(buckets.completed.map((a) => a.id)).toEqual(['completed-1']);
    expect(
      Object.values(buckets)
        .flat()
        .map((a) => a.id),
    ).toHaveLength(rows.length);
  });

  it('returns five empty buckets for an empty list', () => {
    expect(groupStudentAssignments([], now)).toEqual({
      scheduled: [],
      pending: [],
      inProgress: [],
      closed: [],
      completed: [],
    });
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
