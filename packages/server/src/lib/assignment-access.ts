import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureClosed } from '@studiq/server/lib/assessment-close';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { Database } from '@studiq/server/types/database';

/**
 * Who may read a published assessment (#1171). One rule for every student path — the detail, the
 * take, the review — so id-based access cannot bypass the target list.
 */

type AssignmentRow = Database['public']['Tables']['teacher_assignments']['Row'];
type TargetRow = Database['public']['Tables']['assignment_targets']['Row'];

/** A published assessment plus the targets the targeting proof reads. */
export type TargetedAssignment = AssignmentRow & { assignment_targets: TargetRow[] };

/**
 * The assignment `id` when it is published and targets `userId` (directly or through one of their
 * groups); `404` otherwise — a missing row, a draft and a foreign run are indistinguishable.
 *
 * It also makes a run's natural expiry durable: the first read after the deadline writes
 * `closed_at` (and expires the attempts that were still running), so the close survives a later
 * deadline edit (R7/R12).
 */
export async function loadTargetedAssignment(
  supabase: SupabaseClient<Database>,
  id: string,
  userId: string,
): Promise<ServiceResult<TargetedAssignment>> {
  const { data: assignment, error } = await supabase
    .from('teacher_assignments')
    .select('*, assignment_targets(*)')
    .eq('id', id)
    .eq('status', 'published')
    .maybeSingle();

  if (error) return toDbFailure(error);
  if (!assignment) return failure('NOT_FOUND');

  const targeted = await isAssignmentTarget(supabase, assignment, userId);
  if (!targeted.success) return targeted;
  if (!targeted.data) return failure('NOT_FOUND');

  return ensureClosed(assignment);
}

/**
 * A student may see / start an assignment only if it targets them directly, targets one of their
 * groups, or they authored it (teacher preview).
 */
async function isAssignmentTarget(
  supabase: SupabaseClient<Database>,
  assignment: {
    created_by?: string | null;
    organization_id?: string | null;
    assignment_targets?: { group_id?: string | null; student_id?: string | null }[] | null;
  },
  userId: string,
): Promise<ServiceResult<boolean>> {
  // Org content requires current org membership; group_members is not an authorization source on
  // its own (#249). Without this a stale group_members row keeps granting access after the user was
  // removed from the organization.
  if (assignment.organization_id) {
    const { data: membership, error } = await supabase
      .from('org_members')
      .select('id')
      .eq('organization_id', assignment.organization_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!membership) return success(false);
  }

  if (assignment.created_by === userId) return success(true);

  const targets = assignment.assignment_targets ?? [];
  if (targets.some((t) => t.student_id === userId)) return success(true);

  const targetGroupIds = targets.map((t) => t.group_id).filter((g): g is string => !!g);
  if (targetGroupIds.length === 0) return success(false);

  const { data: memberships, error } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId)
    .in('group_id', targetGroupIds);

  if (error) return toDbFailure(error);
  return success(dbRows(memberships).length > 0);
}

/** The groups the caller shares with the assignment's targets — recorded on an exposure event. */
export function cohortGroupIds(
  assignment: { assignment_targets: Pick<TargetRow, 'group_id'>[] },
  studentGroupIds: readonly string[],
): string[] {
  const targeted = new Set(
    assignment.assignment_targets.flatMap((target) => (target.group_id ? [target.group_id] : [])),
  );
  return studentGroupIds.filter((id) => targeted.has(id));
}
