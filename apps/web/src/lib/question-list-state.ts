export interface LoadedQuestionTotal {
  bankId: string;
  total: number;
}

/**
 * `total` the pager renders.
 *
 * React Query only applies `keepPreviousData` while a query is pending: when a page or filter
 * request errors it drops the data, so `total` would fall to 0 and the pager (with the only way
 * back to the previous page) unmounted along with the rows. The list keeps the last total that
 * loaded for the same bank instead, and the banner explains the failure (#668 QA).
 */
export function questionPagerTotal(input: {
  current: number | undefined;
  lastLoaded: LoadedQuestionTotal | undefined;
  bankId: string;
}): number {
  if (input.current !== undefined) return input.current;
  if (input.lastLoaded?.bankId === input.bankId) return input.lastLoaded.total;
  return 0;
}
