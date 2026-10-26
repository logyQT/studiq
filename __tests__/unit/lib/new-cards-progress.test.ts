import { describe, expect, it } from 'vitest';
import { newCardsProgress } from '@/lib/new-cards-progress';

// #315: "Ucz się" showed 95% of the daily new-card budget as used before any card was studied.

describe('newCardsProgress', () => {
  it('is 0% when no new card was introduced today (the reported case: budget 20, 1 card available)', () => {
    expect(newCardsProgress(0, 20)).toBe(0);
  });

  it('is the share of the budget that was introduced', () => {
    expect(newCardsProgress(5, 20)).toBe(25);
    expect(newCardsProgress(10, 20)).toBe(50);
  });

  it('is 100% once the whole budget was introduced and never above', () => {
    expect(newCardsProgress(20, 20)).toBe(100);
    expect(newCardsProgress(25, 20)).toBe(100);
  });

  it('never goes below 0%', () => {
    expect(newCardsProgress(-3, 20)).toBe(0);
  });

  it('treats a budget of 0 as done', () => {
    expect(newCardsProgress(0, 0)).toBe(100);
  });
});
