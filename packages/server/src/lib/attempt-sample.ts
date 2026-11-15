import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { mapSupabaseError } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';

/**
 * The sample one attempt serves (#1174, R6/R7).
 *
 * An assessment binds a **pool** of items; an attempt serves `attempt_item_count` of them (all of
 * them when the teacher did not set a count). That split is what makes a retake possible at all:
 * with the whole pool served every time, a "fresh sample" would always be empty and the only honest
 * answer would be `NO_UNSEEN_ITEMS` forever. Inventory is the cost the plan already names — a class
 * needs several times the items of one attempt.
 *
 * Two things are remembered about a student, and each is a different rule:
 *
 * - `served` — the items their earlier attempts were **served** (`quiz_attempt_questions`). A
 *   same-item retake serves exactly these again, which is what "same item" means.
 * - `seen` — `served`, plus the items they **answered** (`student_answers`; an answer whose link row
 *   is gone still burns the item), plus every item with an **exposure event** for them (the review
 *   of this or another assessment, or practice, already rendered the key, so it is burnt
 *   everywhere). An attempt draws only from outside this set.
 *
 * `seen` is what eligibility reads (#1172, R9): every attempt, first or retake, serves only items
 * this student has not met — unless the teacher declared the item `taught_item`, which waives the
 * ledger event and the prior answer without unsealing anything.
 *
 * Same-item retakes skip the fresh rule, which is why they are an explicit, flagged per-assessment
 * choice rather than the default (`teacher_assignments.allow_same_item_retake`).
 */

/** PostgREST `.in()` values travel in the URL; ids are read in chunks below the gateway limit. */
const ITEM_CHUNK = 200;

/** What this student has already met on this assessment. */
export interface AttemptHistory {
  /** Items an earlier attempt was served, in no particular order. */
  served: Set<string>;
  /** Items that are no longer fresh: served, answered, or with a rendered key. */
  seen: Set<string>;
}

/**
 * The history for one student on one assessment. `candidateIds` bounds the answer and ledger reads
 * to the items this assessment could serve, so the answer does not grow with the student's whole
 * history. Answers are read across **every** attempt of that student: an item they already answered
 * somewhere else is one they met, and R9 excludes it here too.
 */
export async function attemptHistory(
  studentId: string,
  assignmentId: string,
  candidateIds: readonly string[],
): Promise<ServiceResult<AttemptHistory>> {
  const supabase = createServiceClient();
  const served = new Set<string>();
  const seen = new Set<string>();

  const { data: attempts, error: attemptError } = await supabase
    .from('quiz_attempts')
    .select('id')
    .eq('assignment_id', assignmentId)
    .eq('user_id', studentId);

  if (attemptError) return mapSupabaseError(attemptError);
  const attemptIds = dbRows(attempts).map((attempt) => attempt.id);

  if (attemptIds.length > 0) {
    const { data: servedRows, error: servedError } = await supabase
      .from('quiz_attempt_questions')
      .select('question_id')
      .in('attempt_id', attemptIds);
    if (servedError) return mapSupabaseError(servedError);

    for (const row of dbRows(servedRows)) {
      if (!row.question_id) continue;
      served.add(row.question_id);
      seen.add(row.question_id);
    }
  }

  for (let i = 0; i < candidateIds.length; i += ITEM_CHUNK) {
    const chunk = candidateIds.slice(i, i + ITEM_CHUNK);
    const [answers, events] = await Promise.all([
      supabase
        .from('student_answers')
        .select('question_id, quiz_attempts!inner(user_id)')
        .eq('quiz_attempts.user_id', studentId)
        .in('question_id', chunk),
      supabase
        .from('exposure_events')
        .select('question_id')
        .eq('student_id', studentId)
        .in('question_id', chunk),
    ]);
    if (answers.error) return mapSupabaseError(answers.error);
    if (events.error) return mapSupabaseError(events.error);

    for (const row of dbRows(answers.data)) if (row.question_id) seen.add(row.question_id);
    for (const row of dbRows(events.data)) seen.add(row.question_id);
  }

  return success({ served, seen });
}

/** The links whose item this student was already served — the same-item retake set. */
export function sampleServed<T extends { question_id: string | null }>(
  links: readonly T[],
  served: ReadonlySet<string>,
): T[] {
  return links.filter((link) => !!link.question_id && served.has(link.question_id));
}

/**
 * The items an attempt may serve (R9): everything this student has not met, plus every item the
 * teacher declared taught. The declaration is the only way a seen item stays eligible — it waives
 * the ledger event and the prior answer, and nothing else: the item is still sealed during the
 * window and its key is still withheld.
 *
 * A link without a question is kept: the caller already treats it as a corrupt state.
 */
export function sampleEligible<T extends { question_id: string | null; taught_item: boolean }>(
  links: readonly T[],
  seen: ReadonlySet<string>,
): T[] {
  return links.filter(
    (link) => !link.question_id || link.taught_item || !seen.has(link.question_id),
  );
}

/**
 * One attempt's draw: `count` items from `pool`, or the whole pool when the teacher set no count.
 * A subset is drawn at random so an early item is not favoured by its position.
 */
export function drawSample<T>(pool: readonly T[], count: number | null): T[] {
  if (count === null || count >= pool.length) return [...pool];
  return [...pool].toSorted(() => Math.random() - 0.5).slice(0, count);
}
