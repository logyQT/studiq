import { QUESTION_SEARCH_MAX_LENGTH } from '@studiq/server/lib/question-search';
import type { ProblematicQuestionStats } from '@studiq/server/models/stats.model';

/**
 * The start of `text` that the bank search accepts. The limit counts UTF-16 units, so the
 * cut walks whole code points: half of an emoji would reach the URL as a replacement
 * character and match nothing.
 */
function searchPrefix(text: string): string {
  let prefix = '';
  for (const character of text.trim()) {
    if (prefix.length + character.length > QUESTION_SEARCH_MAX_LENGTH) break;
    prefix += character;
  }
  return prefix.trim();
}

/** Where a problem-question alert leads: its bank, searched down to the question. */
export function problemQuestionHref({
  bankId,
  content,
}: Pick<ProblematicQuestionStats, 'bankId' | 'content'>): string {
  const query = new URLSearchParams({ search: searchPrefix(content) });
  return `/edu/questions/${encodeURIComponent(bankId)}?${query.toString()}`;
}
