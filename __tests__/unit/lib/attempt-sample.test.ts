import { drawSample, sampleServed, sampleUnseen } from '@studiq/server/lib/attempt-sample';
import { describe, expect, it } from 'vitest';

// #1174 phase 5: the pure half of the retake sample (R6/R7). The DB half (`attemptHistory`) is
// covered by `__tests__/integration/assessment-retake.test.ts`; these pin the rules that decide
// which bound items one attempt may serve.

const links = (ids: Array<string | null>) => ids.map((question_id) => ({ question_id }));

describe('sampleUnseen (#1174, R7)', () => {
  it('drops every item the student has already met', () => {
    const seen = new Set(['q-1', 'q-3']);
    expect(sampleUnseen(links(['q-1', 'q-2', 'q-3']), seen)).toEqual([{ question_id: 'q-2' }]);
  });

  it('keeps the assignment order and a link without a question', () => {
    expect(sampleUnseen(links(['q-3', null, 'q-1']), new Set(['q-2']))).toEqual([
      { question_id: 'q-3' },
      { question_id: null },
      { question_id: 'q-1' },
    ]);
  });

  it('is empty when the pool holds nothing unseen — the refusal the caller turns into a 409', () => {
    expect(sampleUnseen(links(['q-1', 'q-2']), new Set(['q-1', 'q-2']))).toEqual([]);
  });
});

describe('sampleServed (#1174, R6)', () => {
  it('is the earlier attempt’s items, in the pool order', () => {
    expect(sampleServed(links(['q-1', 'q-2', 'q-3']), new Set(['q-3', 'q-1']))).toEqual([
      { question_id: 'q-1' },
      { question_id: 'q-3' },
    ]);
  });

  it('never claims a link without a question', () => {
    expect(sampleServed(links([null]), new Set())).toEqual([]);
  });
});

describe('drawSample (#1174, R7)', () => {
  const pool = ['a', 'b', 'c', 'd'];

  it('serves the whole pool when no attempt size is configured', () => {
    expect(drawSample(pool, null)).toEqual(pool);
  });

  it('draws exactly the configured size', () => {
    const drawn = drawSample(pool, 2);
    expect(drawn).toHaveLength(2);
    expect(new Set(drawn).size, 'a draw never repeats an item').toBe(2);
    expect(drawn.every((item) => pool.includes(item))).toBe(true);
  });

  it('serves what is left when the pool is smaller than the configured size', () => {
    expect(drawSample(['a', 'b'], 5)).toEqual(['a', 'b']);
  });

  it('does not always draw the same items — the position must not decide', () => {
    const draws = new Set(Array.from({ length: 40 }, () => drawSample(pool, 1).join('')));
    expect(draws.size, 'a one-item draw reaches more than the first item').toBeGreaterThan(1);
  });
});
