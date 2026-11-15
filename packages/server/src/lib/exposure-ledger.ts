import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';

/**
 * The exposure ledger (#1171, R8 / decision g).
 *
 * An event means: the system showed this student this item's key or explanation, so the item is
 * burnt for them. The review is the first surface that renders a key — practice quizzes deliver
 * their feedback through the same review — and phase 3 (#1172) reads these events to keep burnt
 * items out of a graded sample.
 *
 * Recorded with the service role, and only after the caller proved the student may read the result.
 * One row per (student, item): a repeat render conflicts and changes nothing, which is why the
 * write is an upsert with `ignoreDuplicates` rather than a read-then-insert.
 */

export interface Exposure {
  studentId: string;
  /** The items whose key or explanation was actually rendered. */
  questionIds: readonly string[];
  /** The assessment's organisation; omitted for practice, where each item's own org is used. */
  organizationId?: string | null;
  /** The targeted classes the student shares, when the render belongs to an assessment. */
  groupIds?: readonly string[];
}

/**
 * Upserts one event per (student, item). A held-back item was never shown, so it is not passed in
 * and is not burnt.
 */
export async function recordExposure(exposure: Exposure): Promise<ServiceResult<number>> {
  const questionIds = [...new Set(exposure.questionIds)];
  if (questionIds.length === 0) return success(0);

  const supabase = createServiceClient();

  // Practice has no assessment owner: the item's own organisation keeps the event readable by the
  // staff that can already see the item.
  let organizationByItem = new Map<string, string | null>();
  if (exposure.organizationId === undefined) {
    const { data, error } = await supabase
      .from('questions')
      .select('id, organization_id')
      .in('id', questionIds);
    if (error) return toDbFailure(error);
    organizationByItem = new Map(
      dbRows(data).map((question) => [question.id, question.organization_id]),
    );
  }

  const groupIds = [...(exposure.groupIds ?? [])];
  const { data, error } = await supabase
    .from('exposure_events')
    .upsert(
      questionIds.map((questionId) => ({
        student_id: exposure.studentId,
        question_id: questionId,
        organization_id:
          exposure.organizationId === undefined
            ? (organizationByItem.get(questionId) ?? null)
            : exposure.organizationId,
        group_ids: groupIds,
        seen_correct: true,
      })),
      { onConflict: 'student_id,question_id', ignoreDuplicates: true },
    )
    .select('id');

  if (error) return toDbFailure(error);
  return success(dbRows(data).length);
}

/**
 * Records a review render of an assessment attempt. The organisation and the targeted classes the
 * student shares are copied onto the event, so staff can read their own ledger without joining back
 * to an assessment that may since have been deleted.
 */
export async function recordReviewExposure(input: {
  studentId: string;
  assignmentId: string;
  questionIds: readonly string[];
}): Promise<ServiceResult<number>> {
  if (input.questionIds.length === 0) return success(0);

  const supabase = createServiceClient();
  const [assignment, memberships] = await Promise.all([
    supabase
      .from('teacher_assignments')
      .select('organization_id, assignment_targets(group_id)')
      .eq('id', input.assignmentId)
      .maybeSingle(),
    supabase.from('group_members').select('group_id').eq('user_id', input.studentId),
  ]);

  if (assignment.error) return toDbFailure(assignment.error);
  if (memberships.error) return toDbFailure(memberships.error);

  const targetedGroups = new Set(
    dbRows(assignment.data?.assignment_targets).flatMap((target) =>
      target.group_id ? [target.group_id] : [],
    ),
  );
  const groupIds = dbRows(memberships.data)
    .map((row) => row.group_id)
    .filter((id) => targetedGroups.has(id));

  return recordExposure({
    studentId: input.studentId,
    questionIds: input.questionIds,
    organizationId: assignment.data?.organization_id ?? null,
    groupIds,
  });
}
