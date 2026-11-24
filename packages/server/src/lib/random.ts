/**
 * Unbiased shuffling (#1367). `toSorted(() => Math.random() - 0.5)` is not a shuffle: the comparator
 * is inconsistent, so the engine's sort yields a skewed permutation distribution. drawing each item from the remaining pool (Fisher–Yates) is.
 */

/** A uniform random source in [0, 1); injectable so tests can be deterministic. */
export type Rng = () => number;

/** A uniformly shuffled copy of `items`; the input is left untouched. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const pool = [...items];
  const result: T[] = [];
  while (pool.length > 0) {
    result.push(...pool.splice(Math.floor(rng() * pool.length), 1));
  }
  return result;
}

/** `count` items drawn uniformly without replacement (all of them when `count` exceeds the pool). */
export function sample<T>(items: readonly T[], count: number, rng: Rng = Math.random): T[] {
  return shuffle(items, rng).slice(0, Math.max(0, count));
}
