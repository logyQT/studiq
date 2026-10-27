import { resolveListEmptyView } from '@/lib/list-empty-view';

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
 * into a duplicate. The rule itself now lives in `resolveListEmptyView`, shared
 * by every list; this is its question-bank wrapper (an empty grid only).
 */
export function resolveQuestionBankEmptyView(
  input: QuestionBankFilterInput,
): QuestionBankEmptyView {
  const view = resolveListEmptyView({
    visibleCount: 0,
    query: input.query,
    activeFilters: (input.owner !== 'all' ? 1 : 0) + input.groupIds.length,
  });

  return view.kind === 'no-results' ? view : { kind: 'collection-empty' };
}
