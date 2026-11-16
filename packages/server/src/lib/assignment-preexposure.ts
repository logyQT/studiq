import type { SupabaseClient } from '@supabase/supabase-js';
import { assessmentItemIds, memberIds } from '@studiq/server/lib/assignment-exposure';
import { isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import type { Database } from '@studiq/server/types/database';

/**
 * What each targeted class has already seen (#1172, R8).
 *
 * Publishing is the last moment a teacher can declare an item `taughtItem`, so the warning has to
 * say which class is about to be graded on material it has already met. It is information, not a
 * refusal: the blocking decision stays R3's cross-class acknowledgement, and the `422` publish
 * rules are unchanged.
 *
 * Counts only, per target — never an item id, a student id or an option. The teacher already knows
 * the class; what they need is how much of the run is burnt for it.
 */

interface Target {
  group_id: string | null;
  student_id: string | null;
}

export interface TargetPreExposure {
  groupId: string | null;
  studentId: string | null;
  /** Items of this assessment at least one student behind this target has already seen a key for. */
  seenItemCount: number;
  /** How many of those students have seen at least one of the assessment's items. */
  seenStudentCount: number;
}

/** `.in()` values travel in the request URL; ids are read in chunks. */
const PRE_EXPOSURE_CHUNK = 200;

/** One target's students: the group's members, or the single targeted student. */
async function studentsOf(
  supabase: SupabaseClient<Database>,
  target: Target,
): Promise<Set<string>> {
  if (target.group_id) return memberIds(supabase, [target.group_id]);
  return new Set(target.student_id ? [target.student_id] : []);
}

/**
 * The pre-exposure of every target of a draft assessment. Read with the service role: the caller is
 * the author, and the events span students they cannot otherwise see.
 */
export async function assessPreExposure(
  assignmentId: string,
  targets: readonly Target[],
): Promise<ServiceResult<TargetPreExposure[]>> {
  if (targets.length === 0) return success([]);

  const supabase = createServiceClient();
  const items = await assessmentItemIds(supabase, assignmentId);
  if (isFailure(items)) return items;

  const itemIds = items.data;
  if (itemIds.length === 0) return success([]);

  // One read of the assessment's events, then bucket per target: a class's pre-exposure is a
  // filter over the same rows, not another query.
  const events: Array<{ student_id: string; question_id: string }> = [];
  for (let i = 0; i < itemIds.length; i += PRE_EXPOSURE_CHUNK) {
    const { data, error } = await supabase
      .from('exposure_events')
      .select('student_id, question_id')
      .in('question_id', itemIds.slice(i, i + PRE_EXPOSURE_CHUNK));
    if (error) return toDbFailure(error);
    events.push(...dbRows(data));
  }

  const forecast: TargetPreExposure[] = [];
  for (const target of targets) {
    const students = await studentsOf(supabase, target);
    const seenItems = new Set<string>();
    const seenStudents = new Set<string>();
    for (const event of events) {
      if (!students.has(event.student_id)) continue;
      seenItems.add(event.question_id);
      seenStudents.add(event.student_id);
    }
    forecast.push({
      groupId: target.group_id,
      studentId: target.student_id,
      seenItemCount: seenItems.size,
      seenStudentCount: seenStudents.size,
    });
  }

  return success(forecast);
}
