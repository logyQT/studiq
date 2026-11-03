/**
 * Narrowing helpers for values that arrive as `unknown` — a request body, a
 * JSON column, a PostgREST embed. They replace `as Record<string, unknown>`
 * assertions at those boundaries.
 */

/** A non-null object (arrays included: index access is still meaningful). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A string property of an untyped record, or `undefined` for any other value. */
export function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/** A number property of an untyped record, or `undefined` for any other value. */
export function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Reads a property by a name only known at runtime — e.g. a cursor column
 * validated against the list query's `sortBy` enum. Missing keys yield
 * `undefined`, exactly like `row[column]`.
 */
export function readColumn(row: object, column: string): unknown {
  const value: unknown = Reflect.get(row, column);
  return value;
}
