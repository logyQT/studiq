export interface ListEmptyInput {
  /** Rows that are shown after every search and filter was applied. */
  visibleCount: number;
  /** The search text; blank means no search. */
  query?: string;
  /** How many other filters are active (owner, role, group, ...). */
  activeFilters?: number;
}

/**
 * `none`             → the list has rows.
 * `collection-empty` → there really is nothing yet (keep the create call to action).
 * `no-results`       → a search or filter hid every row (name it and offer a reset).
 */
export type ListEmptyView =
  { kind: 'none' } | { kind: 'collection-empty' } | { kind: 'no-results'; query: string | null };

/**
 * Generalised from the question-bank rule of #360 (STU-31) and #595: an empty *filtered* list
 * must not reuse the "nothing here yet, create your first X" copy, which tells owners of
 * existing items their collection is empty. `query` is trimmed, so a whitespace-only search is
 * not an active filter.
 */
export function resolveListEmptyView(input: ListEmptyInput): ListEmptyView {
  if (input.visibleCount > 0) return { kind: 'none' };

  const query = (input.query ?? '').trim();
  if (query.length > 0 || (input.activeFilters ?? 0) > 0) {
    return { kind: 'no-results', query: query.length > 0 ? query : null };
  }

  return { kind: 'collection-empty' };
}
