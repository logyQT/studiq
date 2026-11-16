import { drawSample, sampleEligible, sampleServed } from '@studiq/server/lib/attempt-sample';
import { describe, expect, it } from 'vitest';

// #1174 phase 5: the pure half of the retake sample (R6/R7), and #1172: eligibility (R8/R9).
// Exposure excludes an item only for an assessment that opted into `unseen_only`; the retake rule
// (served + answered) holds in both modes. The DB half (`attemptHistory`) is covered by the
// integration tests; these pin the rules that decide which bound items one attempt may serve.

const links = (ids: Array<string | null>) =>
  ids.map((question_id) => ({ question_id, taught_item: false }));

const nothing = { seen: new Set<string>(), exposed: new Set<string>() };

describe('sampleEligible with unseen_only off (#1172 revisited)', () => {
  it('serves an item whose key the student already saw — exposure is information, not exclusion', () => {
    const exclusion = { seen: new Set<string>(), exposed: new Set(['q-1']) };
    expect(sampleEligible(links(['q-1', 'q-2']), exclusion, false)).toEqual([
      { question_id: 'q-1', taught_item: false },
      { question_id: 'q-2', taught_item: false },
    ]);
  });

  it('still leaves out what a retake must not repeat: served and answered items', () => {
    const exclusion = { seen: new Set(['q-1', 'q-3']), exposed: new Set<string>() };
    expect(sampleEligible(links(['q-1', 'q-2', 'q-3']), exclusion, false)).toEqual([
      { question_id: 'q-2', taught_item: false },
    ]);
  });

  it('leaves taughtItem inert: the declaration changes nothing outside unseen_only', () => {
    const taught = [
      { question_id: 'q-1', taught_item: true },
      { question_id: 'q-2', taught_item: false },
    ];
    const exclusion = { seen: new Set(['q-1']), exposed: new Set<string>() };
    expect(sampleEligible(taught, exclusion, false)).toEqual([
      { question_id: 'q-2', taught_item: false },
    ]);
  });
});

describe('sampleEligible with unseen_only on (#1172, R8/R9)', () => {
  it('drops every item the student has already met', () => {
    const exclusion = { seen: new Set(['q-1']), exposed: new Set(['q-3']) };
    expect(sampleEligible(links(['q-1', 'q-2', 'q-3']), exclusion, true)).toEqual([
      { question_id: 'q-2', taught_item: false },
    ]);
  });

  it('serves a taught item despite a ledger event or a prior answer', () => {
    const taught = [
      { question_id: 'q-1', taught_item: true },
      { question_id: 'q-2', taught_item: true },
      { question_id: 'q-3', taught_item: false },
    ];
    const exclusion = { seen: new Set(['q-2', 'q-3']), exposed: new Set(['q-1']) };
    expect(sampleEligible(taught, exclusion, true)).toEqual([
      { question_id: 'q-1', taught_item: true },
      { question_id: 'q-2', taught_item: true },
    ]);
  });

  it('keeps the assignment order and a link without a question', () => {
    expect(sampleEligible(links(['q-3', null, 'q-1']), nothing, true)).toEqual([
      { question_id: 'q-3', taught_item: false },
      { question_id: null, taught_item: false },
      { question_id: 'q-1', taught_item: false },
    ]);
  });

  it('is empty when the pool holds nothing eligible — the refusal the caller turns into a 409', () => {
    const exclusion = { seen: new Set(['q-1']), exposed: new Set(['q-2']) };
    expect(sampleEligible(links(['q-1', 'q-2']), exclusion, true)).toEqual([]);
  });
});

describe('sampleServed (#1174, R6)', () => {
  it('is the earlier attempt’s items, in the pool order', () => {
    expect(sampleServed(links(['q-1', 'q-2', 'q-3']), new Set(['q-3', 'q-1']))).toEqual([
      { question_id: 'q-1', taught_item: false },
      { question_id: 'q-3', taught_item: false },
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
