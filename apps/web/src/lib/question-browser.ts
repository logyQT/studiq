export interface BrowseQuestion {
  id: string;
  content: string;
  type: string;
}

/**
 * The rows the quiz builder's picker can offer: the server already applied the search term,
 * so the client only drops the questions already in the quiz.
 *
 * Filtering the response again by the raw input used to hide rows the API had returned: the
 * server searches the trimmed term and treats `*` as a wildcard (#651 QA).
 */
export function availableQuestions<T extends { id: string }>(
  questions: readonly T[] | undefined,
  existingIds: ReadonlySet<string>,
): T[] {
  return (questions ?? []).filter((question) => !existingIds.has(question.id));
}
