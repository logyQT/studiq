import {
  drawStratifiedSample,
  sampleEligible,
  sampleServed,
} from '@studiq/server/lib/attempt-sample';
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

/** A deterministic uniform source in [0, 1) (mulberry32), so every draw below is reproducible. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const SEEDS = Array.from({ length: 200 }, (_, index) => index + 1);
/** A class's worth of students: enough seeds for a minority type's rate to be measurable. */
const CLASS_SEEDS = Array.from({ length: 500 }, (_, index) => index + 1);

/** `count` items of each type, named `<type><n>`, so a test can read a draw's mix off the ids. */
function poolOf(sizes: Record<string, number>): string[] {
  return Object.entries(sizes).flatMap(([type, size]) =>
    Array.from({ length: size }, (_, index) => `${type}${index + 1}`),
  );
}

const typeOfId = (id: string): string => id.replace(/\d+$/, '');

/** A type for every id except the `ghost` ones, whose type is unknown. */
const typeOfOrUnknown = (id: string): string | undefined =>
  id.startsWith('ghost') ? undefined : typeOfId(id);

function mixOf(drawn: readonly string[]): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const id of drawn) mix[typeOfId(id)] = (mix[typeOfId(id)] ?? 0) + 1;
  return mix;
}

describe('drawStratifiedSample (#1174 R7, #1295)', () => {
  const pool = ['a1', 'a2', 'a3', 'a4'];

  it('serves the whole pool when no attempt size is configured', () => {
    expect(drawStratifiedSample(pool, null, typeOfId)).toEqual(pool);
  });

  it('serves what is left when the pool is not larger than the configured size', () => {
    const small = ['a1', 'b1'];
    expect(drawStratifiedSample(small, 2, typeOfId)).toEqual(small);
    expect(drawStratifiedSample(small, 5, typeOfId)).toEqual(small);
  });

  it('copies the pool instead of handing back the caller array', () => {
    expect(drawStratifiedSample(pool, null, typeOfId)).not.toBe(pool);
  });

  it('draws exactly the configured size, from the pool, without repeating an item', () => {
    const mixed = poolOf({ mcq: 10, tf: 6, open: 4 });
    for (const seed of SEEDS) {
      const drawn = drawStratifiedSample(mixed, 7, typeOfId, seeded(seed));
      expect(drawn).toHaveLength(7);
      expect(new Set(drawn).size, 'a draw never repeats an item').toBe(7);
      expect(drawn.every((id) => mixed.includes(id))).toBe(true);
    }
  });

  it('keeps every type within one item of its share of the pool', () => {
    // 20 items, 7 drawn: shares are 3.5 (mcq), 2.1 (tf) and 1.4 (open).
    const mixed = poolOf({ mcq: 10, tf: 6, open: 4 });
    for (const seed of SEEDS) {
      const mix = mixOf(drawStratifiedSample(mixed, 7, typeOfId, seeded(seed)));
      expect(mix.mcq, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      expect(mix.mcq, `seed ${seed}`).toBeLessThanOrEqual(4);
      expect(mix.tf, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(mix.tf, `seed ${seed}`).toBeLessThanOrEqual(3);
      expect(mix.open, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(mix.open, `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });

  it('gives each student the same mix when the pool divides evenly', () => {
    const mixed = poolOf({ mcq: 6, open: 6 });
    for (const seed of SEEDS) {
      expect(mixOf(drawStratifiedSample(mixed, 6, typeOfId, seeded(seed)))).toEqual({
        mcq: 3,
        open: 3,
      });
    }
  });

  it('breaks a tie between equal remainders at random, not by position', () => {
    // One seat, two types with the same share: the first-listed type must not always win it.
    const tied = poolOf({ mcq: 2, open: 2 });
    const first = new Set(
      SEEDS.map((seed) => typeOfId(drawStratifiedSample(tied, 1, typeOfId, seeded(seed))[0] ?? '')),
    );
    expect([...first].toSorted()).toEqual(['mcq', 'open']);
  });

  it('draws from a pool of one type', () => {
    const only = poolOf({ mcq: 8 });
    for (const seed of SEEDS) {
      const drawn = drawStratifiedSample(only, 3, typeOfId, seeded(seed));
      expect(drawn).toHaveLength(3);
      expect(new Set(drawn).size).toBe(3);
    }
  });

  it('reaches every item of a one-type pool — the position must not decide', () => {
    const only = poolOf({ mcq: 4 });
    const reached = new Set(
      SEEDS.map((seed) => drawStratifiedSample(only, 1, typeOfId, seeded(seed)).join('')),
    );
    expect(reached.size, 'a one-item draw reaches every item').toBe(4);
  });

  it('puts items without a known type in one bucket of their own', () => {
    const typed = poolOf({ mcq: 6 });
    const untyped = poolOf({ ghost: 6 });
    const withGhosts = [...typed, ...untyped];
    for (const seed of SEEDS) {
      const drawn = drawStratifiedSample(withGhosts, 6, typeOfOrUnknown, seeded(seed));
      expect(mixOf(drawn), `seed ${seed}`).toEqual({ mcq: 3, ghost: 3 });
    }
  });

  it('draws one item from some of the types when the size is below the number of types', () => {
    const four = poolOf({ a: 3, b: 3, c: 3, d: 3 });
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const drawn = drawStratifiedSample(four, 2, typeOfId, seeded(seed));
      const types = drawn.map(typeOfId);
      expect(drawn).toHaveLength(2);
      expect(new Set(types).size, `seed ${seed}: two different types`).toBe(2);
      for (const type of types) seen.add(type);
    }
    expect([...seen].toSorted(), 'no type is permanently left out').toEqual(['a', 'b', 'c', 'd']);
  });

  it('serves a type that misses its floor to some students, never to none (#1295)', () => {
    // 4 mcq + 1 open, count 2: mcq's share is 1.6 and open's 0.4, so the one leftover seat used to
    // go to mcq for every student and the open item was unreachable. Both compositions must occur,
    // and open must be as likely as a uniform slice made it (2/5 of the draws, i.e. 1/5 per seat).
    const skewed = poolOf({ mcq: 4, open: 1 });
    const compositions = new Set<string>();
    let openDraws = 0;
    for (const seed of CLASS_SEEDS) {
      const mix = mixOf(drawStratifiedSample(skewed, 2, typeOfId, seeded(seed)));
      expect(mix.open ?? 0, `seed ${seed}: the pool holds one open item`).toBeLessThanOrEqual(1);
      compositions.add(`mcq${mix.mcq ?? 0}+open${mix.open ?? 0}`);
      if ((mix.open ?? 0) === 1) openDraws += 1;
    }
    expect([...compositions].toSorted()).toEqual(['mcq1+open1', 'mcq2+open0']);
    expect(openDraws / CLASS_SEEDS.length).toBeGreaterThan(0.3);
    expect(openDraws / CLASS_SEEDS.length).toBeLessThan(0.5);
  });

  it('serves a graded minority item to some students in an open-heavy pool (#1295)', () => {
    // 40 open + 2 mcq, count 10: open's floor is 9 and the leftover seat is a coin toss weighted by
    // the remainders, so a student gets the graded item about half the time instead of never.
    const skewed = poolOf({ open: 40, mcq: 2 });
    const compositions = new Set<string>();
    let gradedDraws = 0;
    for (const seed of CLASS_SEEDS) {
      const mix = mixOf(drawStratifiedSample(skewed, 10, typeOfId, seeded(seed)));
      compositions.add(`open${mix.open ?? 0}+mcq${mix.mcq ?? 0}`);
      if ((mix.mcq ?? 0) === 1) gradedDraws += 1;
    }
    expect([...compositions].toSorted()).toEqual(['open10+mcq0', 'open9+mcq1']);
    expect(gradedDraws / CLASS_SEEDS.length).toBeGreaterThan(0.35);
    expect(gradedDraws / CLASS_SEEDS.length).toBeLessThan(0.6);
  });

  it('keeps the class-average mix proportional to the pool (#1295)', () => {
    // 20 items, 7 drawn: shares are 3.5 (mcq), 2.1 (tf) and 1.4 (open). Leftover seats are stochastic
    // but their expectation is the fractional share, so the average a class receives stays on it.
    const mixed = poolOf({ mcq: 10, tf: 6, open: 4 });
    const total = { mcq: 0, tf: 0, open: 0 };
    for (const seed of CLASS_SEEDS) {
      const mix = mixOf(drawStratifiedSample(mixed, 7, typeOfId, seeded(seed)));
      total.mcq += mix.mcq ?? 0;
      total.tf += mix.tf ?? 0;
      total.open += mix.open ?? 0;
    }
    expect(total.mcq / CLASS_SEEDS.length).toBeGreaterThan(3.3);
    expect(total.mcq / CLASS_SEEDS.length).toBeLessThan(3.7);
    expect(total.tf / CLASS_SEEDS.length).toBeGreaterThan(1.9);
    expect(total.tf / CLASS_SEEDS.length).toBeLessThan(2.3);
    expect(total.open / CLASS_SEEDS.length).toBeGreaterThan(1.2);
    expect(total.open / CLASS_SEEDS.length).toBeLessThan(1.6);
  });

  it('shuffles the result so its order does not reveal the types', () => {
    const mixed = poolOf({ mcq: 4, open: 4 });
    const patterns = new Set(
      SEEDS.map((seed) =>
        drawStratifiedSample(mixed, 4, typeOfId, seeded(seed))
          .map((id) => typeOfId(id)[0])
          .join(''),
      ),
    );
    // Grouped by type there would be only `mmoo`; a shuffle interleaves.
    expect(patterns.size).toBeGreaterThan(2);
  });

  it('leaves the pool untouched', () => {
    const mixed = poolOf({ mcq: 3, open: 3 });
    const before = [...mixed];
    drawStratifiedSample(mixed, 2, typeOfId, seeded(1));
    expect(mixed).toEqual(before);
  });
});
