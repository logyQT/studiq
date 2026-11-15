import { isAssessmentClosed } from '@studiq/server/lib/assessment-close';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/**
 * The single place that answers "may this student see the results?" (#374).
 *
 * `teacher_assignments.show_results` is opt-in, so anything but an explicit
 * `true` hides the score, per-question correctness, teacher points/feedback and
 * the answer key. A missing row fails closed for the same reason.
 */
export function resultsHidden(
  assignment: { show_results?: boolean | null } | null | undefined,
): boolean {
  return assignment?.show_results !== true;
}

/**
 * The assignments among `assignmentIds` whose results are hidden from students.
 *
 * Fails closed both ways: a lookup error is returned as a `ServiceResult`
 * failure (so the caller cannot serve data), and an id missing from the result
 * (deleted or RLS-hidden) counts as hidden.
 */
export async function hiddenResultAssignmentIds(
  supabase: SupabaseClient<Database>,
  assignmentIds: readonly (string | null | undefined)[],
): Promise<ServiceResult<Set<string>>> {
  const ids = [...new Set(assignmentIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return success(new Set<string>());

  const { data, error } = await supabase
    .from('teacher_assignments')
    .select('id, show_results')
    .in('id', ids);

  if (error) return toDbFailure(error);

  const visible = new Set(
    dbRows(data)
      .filter((assignment) => !resultsHidden(assignment))
      .map((assignment) => assignment.id),
  );
  return success(new Set(ids.filter((id) => !visible.has(id))));
}

/**
 * Whether a review exists at all and whether it may be read now (#1171, R5; #1174, R12).
 *
 * `hidden` — the teacher never enabled results, so there is no review at any time (not a lock) — or
 * the run was cancelled, which has no reveal at all: cancelling ends the run without handing the
 * cohort the key.
 * `locked` — results are on, but the assessment has not closed yet: the key is not out.
 * `open`   — the assessment closed; the whole cohort may read the review.
 */
export function reviewState(
  assignment:
    | {
        status?: string | null;
        show_results?: boolean | null;
        closed_at?: string | null;
        deadline?: string | null;
      }
    | null
    | undefined,
  now: Date = new Date(),
): 'hidden' | 'locked' | 'open' {
  if (!assignment || resultsHidden(assignment)) return 'hidden';
  if (assignment.status === 'cancelled') return 'hidden';
  return isAssessmentClosed(assignment, now) ? 'open' : 'locked';
}
