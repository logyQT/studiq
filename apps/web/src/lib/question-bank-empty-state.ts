/** Filter values that decide whether the bank grid is empty because of a filter. */
export interface QuestionBankFilterInput {
  query: string;
  owner: string;
  groupIds: string[];
}

/**
 * `collection-empty` → the account really has no banks (keep the create CTA).
 * `no-results`       → a search/ownership/group filter hid every bank.
 */
export type QuestionBankEmptyView =
  { kind: 'collection-empty' } | { kind: 'no-results'; query: string | null };

/**
 * #360 (STU-31) — `/app/questions` and `/edu/questions` reused the
 * “nothing here yet, create your first bank” copy for an empty *filtered* list,
 * telling owners of existing banks their collection is empty and nudging them
 * into a duplicate. Split the two causes so the screen can name the active
 * search and offer a reset instead.
 *
 * `query` is trimmed here and in the request itself, so a whitespace-only
 * search is not treated as an active filter.
 */
export function resolveQuestionBankEmptyView(
  input: QuestionBankFilterInput,
): QuestionBankEmptyView {
  const query = input.query.trim();
  const hasActiveFilter = query.length > 0 || input.owner !== 'all' || input.groupIds.length > 0;

  if (!hasActiveFilter) return { kind: 'collection-empty' };

  return { kind: 'no-results', query: query.length > 0 ? query : null };
}
