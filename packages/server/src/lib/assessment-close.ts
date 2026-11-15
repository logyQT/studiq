import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';

/**
 * The durable close of an assessment (#1171, R7/R12).
 *
 * A run closes at its `deadline` or when a teacher closes it explicitly, and both write
 * `closed_at`. That column — not the clock — is what the seal, the review and the attempt gate read,
 * so a later deadline edit cannot reopen a closed run: the repair path is a new assessment (R12).
 * The database pins it too (a trigger refuses to clear or move it).
 *
 * In-progress attempts expire at the same instant (`quiz_attempts.expired_at`): they count as
 * consumed and can no longer be submitted, and the submit RPC refuses an expired row even if a
 * caller bypasses this module.
 */

/** The window fields every close decision needs. */
export interface AssessmentWindow {
  id: string;
  status: string;
  start_time: string | null;
  deadline: string | null;
  closed_at: string | null;
}

/** The two columns that decide a close; optional so a projected row can pass through. */
export interface CloseBounds {
  closed_at?: string | null;
  deadline?: string | null;
}

/** The moment a run stops taking attempts: the explicit close wins over the deadline. */
export function effectiveCloseAt(run: CloseBounds): string | null {
  return run.closed_at ?? run.deadline ?? null;
}

/**
 * Closed once `closed_at` is written, or once the clock has passed the deadline. The read is a
 * *derived* answer; `ensureClosed` writes it down, which is what makes it durable.
 */
export function isAssessmentClosed(run: CloseBounds, now: Date = new Date()): boolean {
  if (run.closed_at) return true;
  return !!run.deadline && now.getTime() >= new Date(run.deadline).getTime();
}

/** Live = published, opened, and not closed: the only state that accepts an attempt (R7). */
export function isAssessmentLive(
  run: Pick<AssessmentWindow, 'status' | 'start_time' | 'closed_at' | 'deadline'>,
  now: Date = new Date(),
): boolean {
  if (run.status !== 'published') return false;
  if (run.start_time && now.getTime() < new Date(run.start_time).getTime()) return false;
  return !isAssessmentClosed(run, now);
}

/** Marks every still-running attempt of the run expired; returns how many it stamped. */
export async function expireInProgressAttempts(
  assignmentId: string,
  closedAt: string,
): Promise<ServiceResult<number>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('quiz_attempts')
    .update({ expired_at: closedAt })
    .eq('assignment_id', assignmentId)
    .is('completed_at', null)
    .is('expired_at', null)
    .select('id');

  if (error) return toDbFailure(error);
  return success(dbRows(data).length);
}

/**
 * Writes `closed_at` the first time the clock is past the deadline and expires the attempts that
 * were still running. Idempotent: the conditional update only fills an empty column, and a row that
 * is already closed is left exactly as it is.
 *
 * The write needs the service role because the caller is often the student whose read observed the
 * expiry; it never creates a closure, it only records the one the clock already made.
 */
export async function ensureClosed<T extends AssessmentWindow>(
  run: T,
  now: Date = new Date(),
): Promise<ServiceResult<T>> {
  if (run.status !== 'published' || run.closed_at || !run.deadline) return success(run);
  if (now.getTime() < new Date(run.deadline).getTime()) return success(run);

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('teacher_assignments')
    .update({ closed_at: run.deadline })
    .eq('id', run.id)
    .is('closed_at', null)
    .eq('status', 'published')
    .select('closed_at')
    .maybeSingle();

  if (error) return toDbFailure(error);

  // A concurrent reader may have stamped it first; `maybeSingle` returns nothing then, and the
  // row's own value is the truth for this response.
  const closedAt = data?.closed_at ?? run.deadline;
  const expired = await expireInProgressAttempts(run.id, closedAt);
  if (!expired.success) return expired;

  return success({ ...run, closed_at: closedAt });
}
