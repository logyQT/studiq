/**
 * The slice of the PostgREST filter builder a list query touches. Every method
 * returns the same builder, so the caller keeps the projection's row type —
 * which is why filters are applied to an already-`select()`ed query instead of
 * being rebuilt from a dynamic select string (a dynamic string erases the row
 * type and forces an assertion at the end of the chain).
 */
export interface FilterableBuilder<T> {
  or(filters: string): T;
  eq(column: string, value: string): T;
  not(column: string, operator: string, value: string): T;
  in(column: string, values: readonly string[]): T;
}

/** The same builder, for filters that also need `is`/`ilike`/`filter`. */
export interface FilterableBuilderWithExtra<T> extends FilterableBuilder<T> {
  is(column: string, value: boolean | null): T;
  ilike(column: string, pattern: string): T;
  filter(column: string, operator: string, value: string): T;
}
