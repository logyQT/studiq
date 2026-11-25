import { QUESTION_SEARCH_MAX_LENGTH } from '@studiq/server/lib/question-search';
import type { ProblematicQuestionStats } from '@studiq/server/models/stats.model';

/**
 * The start of `text` that the bank search accepts. The limit counts code points, as the
 * schema's `max` does. Cutting by `slice` would count UTF-16 units and could leave half of
 * an emoji, which reaches the URL as a replacement character and matches nothing.
 */
function searchPrefix(text: string): string {
  return Array.from(text.trim()).slice(0, QUESTION_SEARCH_MAX_LENGTH).join('').trim();
}

/** Where a problem-question alert leads: its bank, searched down to the question. */
export function problemQuestionHref({
  bankId,
  content,
}: Pick<ProblematicQuestionStats, 'bankId' | 'content'>): string {
  const query = new URLSearchParams({ search: searchPrefix(content) });
  return `/edu/questions/${encodeURIComponent(bankId)}?${query.toString()}`;
}
