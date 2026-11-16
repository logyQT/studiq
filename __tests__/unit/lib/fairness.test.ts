import { describe, expect, it } from 'vitest';
import { FAIRNESS_MIN_RESPONDENTS, fairnessItem } from '@studiq/server/lib/fairness';

// #1172 phase 3 (slice B2): fairness is counts only, a taught item is labelled and excluded, and a
// cell under five respondents is suppressed. These pin the two rules the endpoint must not drift
// from; the DB half is covered by `__tests__/integration/exposure-fairness.test.ts`.

describe('fairnessItem (#1172, R9)', () => {
  const base = { questionId: 'q-1', taughtItem: false, served: 6, correct: 4, ungraded: 0 };

  it('reports the counts once the cell has enough respondents', () => {
    expect(fairnessItem(base)).toEqual({
      questionId: 'q-1',
      taughtItem: false,
      served: 6,
      correct: 4,
      ungraded: 0,
    });
  });

  it('suppresses a cell below the threshold', () => {
    expect(fairnessItem({ ...base, served: FAIRNESS_MIN_RESPONDENTS - 1 })).toEqual({
      questionId: 'q-1',
      taughtItem: false,
      served: null,
      correct: null,
      ungraded: null,
    });
  });

  it('labels a taught item and never counts it, however many sat it', () => {
    expect(fairnessItem({ ...base, taughtItem: true, served: 40 })).toEqual({
      questionId: 'q-1',
      taughtItem: true,
      served: null,
      correct: null,
      ungraded: null,
    });
  });
});
