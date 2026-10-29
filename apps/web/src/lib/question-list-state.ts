/**
 * A failed first load has nothing to draw: the table must not fall through to the
 * "no questions in this bank / create your first question" row next to the error banner,
 * which invited a read-only viewer to create a question in a bank that never loaded.
 *
 * A failed refetch that still has a page keeps the stale rows and the banner (#651 QA).
 */
export function isQuestionListUnavailable(input: { isError: boolean; hasPage: boolean }): boolean {
  return input.isError && !input.hasPage;
}
