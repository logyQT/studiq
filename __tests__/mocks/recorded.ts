/**
 * Accessors for values a test expects to exist.
 *
 * `noUncheckedIndexedAccess` makes `mock.calls[0]`, `rows[0]` and `map[key]`
 * honestly optional: the test may be reading something the code under test (or
 * the fixture) never produced. These helpers turn that into a failing assertion
 * with a diagnostic instead of a silent comparison against `undefined`.
 */

/** A value the test requires, failing with the caller's label when it is absent. */
export function requiredValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`expected ${label}`);
  return value;
}

/** The argument tuple of the first call made to `mock`. */
export function firstCall<Args extends readonly unknown[]>(mock: {
  mock: { calls: readonly Args[] };
}): Args {
  return requiredValue(mock.mock.calls[0], 'the mock to have been called');
}

/** The item at `index` of a recording list the code under test may not have produced. */
export function recordedAt<T>(items: readonly T[] | undefined, index: number, label: string): T {
  return requiredValue(items?.[index], label);
}

/** The first item of a recording list the code under test may not have produced. */
export function firstRecorded<T>(items: readonly T[] | undefined, label = 'a recorded item'): T {
  return recordedAt(items, 0, label);
}
