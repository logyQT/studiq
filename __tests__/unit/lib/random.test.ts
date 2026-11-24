import { describe, expect, it } from 'vitest';
import { sample, shuffle } from '@studiq/server/lib/random';

/** mulberry32 — a small seeded RNG so the frequency tests are reproducible. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('shuffle', () => {
  it('returns a copy and leaves the input untouched', () => {
    const input = [1, 2, 3, 4];
    const out = shuffle(input, seeded(1));
    expect(out).not.toBe(input);
    expect(input).toEqual([1, 2, 3, 4]);
    expect(out.toSorted()).toEqual([1, 2, 3, 4]);
  });

  it('handles empty and single-item input', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(['a'])).toEqual(['a']);
  });

  it('is deterministic for an injected RNG', () => {
    expect(shuffle(['a', 'b', 'c'], () => 0)).toEqual(['a', 'b', 'c']);
    expect(shuffle(['a', 'b', 'c'], () => 0.999999)).toEqual(['c', 'b', 'a']);
  });

  it('is uniform: every permutation of 3 items is near 1/6 and identity is not favoured (#1367)', () => {
    const trials = 60_000;
    const rng = seeded(42);
    const counts = new Map<string, number>();
    for (let i = 0; i < trials; i++) {
      const key = shuffle(['a', 'b', 'c'], rng).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const count of counts.values()) {
      expect(Math.abs(count / trials - 1 / 6)).toBeLessThan(0.015);
    }
    expect((counts.get('abc') ?? 0) / trials).toBeLessThan(0.2);
  });
});

describe('sample', () => {
  it('draws count distinct items from the pool', () => {
    const drawn = sample([1, 2, 3, 4, 5], 3, seeded(7));
    expect(drawn).toHaveLength(3);
    expect(new Set(drawn).size).toBe(3);
  });

  it('returns the whole pool when count exceeds it, and nothing for a non-positive count', () => {
    expect(sample([1, 2], 5, seeded(1)).toSorted()).toEqual([1, 2]);
    expect(sample([1, 2], 0)).toEqual([]);
    expect(sample([1, 2], -1)).toEqual([]);
  });

  it('includes every position about equally often (#1367)', () => {
    const trials = 40_000;
    const rng = seeded(99);
    const hits = new Array<number>(8).fill(0);
    for (let i = 0; i < trials; i++) {
      for (const item of sample([0, 1, 2, 3, 4, 5, 6, 7], 1, rng))
        hits[item] = (hits[item] ?? 0) + 1;
    }
    for (const h of hits) expect(Math.abs(h / trials - 1 / 8)).toBeLessThan(0.01);
  });
});
