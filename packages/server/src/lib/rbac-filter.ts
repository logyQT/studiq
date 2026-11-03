/**
 * `buildQueryFilter`/`accessibleFilter` answer with a leading-underscore
 * sentinel (`_impossible`) when the resolved scope can never match a row.
 * Services read it through this predicate (presence check, so no dangling
 * underscore member access) instead of poking at the sentinel themselves.
 */
export function isImpossibleFilter(filter: { _impossible?: true }): boolean {
  return '_impossible' in filter;
}
