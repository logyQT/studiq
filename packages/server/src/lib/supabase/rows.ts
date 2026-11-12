/**
 * The runtime shape of a PostgREST projection.
 *
 * The generated `Database` type describes what a *complete* payload looks like:
 * a list read is an array, a `select('*, child(*)')` embed is present, and a
 * `child(count)` aggregate has one row. That is what the API returns when the
 * query and the row are whole — but it is not what the caller can rely on:
 *
 * - a successful list read is typed `T[]` even though the wire can carry `null`;
 * - a partial payload, a mocked client or an RLS-trimmed row can omit an embed;
 * - a `count` aggregate over an empty relation is an empty array, not `[{ count }]`.
 *
 * These helpers put those three claims in one place instead of repeating a
 * defensive `?? []` that the type checker calls dead. Every read is widened to
 * what the wire can actually deliver, so the fallback is required by the type
 * rather than hidden behind an assertion.
 */

/** A list projection that may have arrived empty, missing or without its sibling embed. */
export function dbRows<T>(data: T[] | null | undefined): T[] {
  return data ?? [];
}

/** A `child(count)` embed: empty when the relation has no rows or the payload omitted it. */
export function dbCount(embed: readonly { count: number }[] | null | undefined): number {
  return embed?.[0]?.count ?? 0;
}

/** A single-object embed (`parent(*, child(*))`) that a partial payload can omit. */
export function dbNested<T>(value: T | null | undefined): T | null {
  return value ?? null;
}
