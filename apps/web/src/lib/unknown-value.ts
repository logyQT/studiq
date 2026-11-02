/**
 * Narrowing helpers for values whose static type is `unknown` — request bodies,
 * third-party callback payloads, `response.json()`. They let callers keep working
 * with the real runtime shape instead of asserting one, so the compiler keeps
 * checking every property access.
 */

/** `true` for a non-null, non-array object — the shape of every JSON object payload. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a string field of an untyped payload; `undefined` when absent or not a string. */
export function readStringField(data: unknown, field: string): string | undefined {
  if (!isRecord(data) || !(field in data)) return undefined;
  const value: unknown = Reflect.get(data, field);
  return typeof value === 'string' ? value : undefined;
}

/** The item count of an array-shaped value, else `0` — for labels built off an untyped payload. */
export function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** The record items of an array-shaped value; anything that is not an object is skipped. */
export function recordsOf(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const records: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (isRecord(item)) records.push(item);
  }
  return records;
}

/** The value when it is an array of strings, else `undefined`. */
export function stringsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return undefined;
    strings.push(item);
  }
  return strings;
}
