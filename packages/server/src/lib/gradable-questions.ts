import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A question is auto-gradable unless it is an open answer (#329).
 *
 * Open answers have no answer key, so they are stored `is_correct = false` and
 * can never contribute to an auto-graded score. A missing type (deleted or
 * RLS-hidden question embed) is treated the same way: it must not sit in the
 * denominator.
 */
export function isGradableQuestionType(type: string | null | undefined): boolean {
  return !!type && type !== 'open';
}

/** PostgREST caps a response at `api.max_rows` (1000), so pages are explicit. */
const PAGE_SIZE = 1000;

/**
 * `attempt_id` filters travel in the URL, so a long history is split into
 * chunks instead of one ever-growing `.in()` list.
 */
const ID_CHUNK_SIZE = 100;

/**
 * Auto-gradable question count per attempt, derived from the attempt snapshot
 * join (`quiz_attempt_questions` → `questions.type`).
 *
 * This is the single place that owns the "practice denominator = closed
 * questions" rule (#329): the attempt list and the student stats aggregates must
 * agree with the review headline for the same attempt (#619). Counts are derived
 * from the snapshot, so no stored counter is rewritten and no migration is
 * needed.
 *
 * Missing / RLS-hidden question embeds never count as gradable. Rows are paged
 * because a silent truncation at the 1000-row cap would *shrink* the denominator
 * and inflate every percentage.
 */
export async function gradableQuestionCounts(
  supabase: SupabaseClient,
  attemptIds: readonly string[],
): Promise<ServiceResult<Map<string, number>>> {
  const ids = [...new Set(attemptIds)];
  const counts = new Map<string, number>();
  if (ids.length === 0) return success(counts);

  for (let chunkStart = 0; chunkStart < ids.length; chunkStart += ID_CHUNK_SIZE) {
    const chunk = ids.slice(chunkStart, chunkStart + ID_CHUNK_SIZE);

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('quiz_attempt_questions')
        .select('attempt_id, questions(type)')
        // A total order over the primary key keeps the pages stable; without it
        // PostgREST may repeat or skip rows between requests.
        .order('attempt_id', { ascending: true })
        .order('question_id', { ascending: true })
        .in('attempt_id', chunk)
        .range(from, from + PAGE_SIZE - 1);

      if (error) return toDbFailure(error);

      const rows = data ?? [];
      for (const row of rows) {
        // PostgREST returns a to-one embed as an object; a missing/RLS-hidden
        // question is null and must not count as gradable.
        const type = (row.questions as { type?: string } | null)?.type;
        if (!isGradableQuestionType(type)) continue;
        counts.set(row.attempt_id, (counts.get(row.attempt_id) ?? 0) + 1);
      }

      if (rows.length < PAGE_SIZE) break;
    }
  }

  return success(counts);
}
