import type { SupabaseClient } from '@supabase/supabase-js';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import type { Database } from '@studiq/server/types/database';

/**
 * Cross-class exposure at publish (#1171, R3).
 *
 * An assessment seals its items for the classes it targets, so every other class that can still
 * practise them is a decision the teacher has to make explicitly, not a warning they can dismiss.
 * Reach is the app's own rule: a student practises an item because their group is shared the item's
 * bank (`bank_groups`), which is what a reader's `question.read` group scope resolves to. An item
 * is therefore exposed outside the cohort when a group shared that bank has a student outside it.
 *
 * The forecast is counts only: it never returns an item id or a student id.
 */

/** `.in()` values travel in the request URL; ids are read in chunks. */
const EXPOSURE_CHUNK = 200;

export interface ExposureForecast {
  /** Items in the assessment a student outside the cohort can still practise. */
  openItemCount: number;
  /** How many students outside the cohort can reach at least one of them. */
  outsideStudentCount: number;
}

interface Target {
  group_id: string | null;
  student_id: string | null;
}

/** Student members (`role = 'member'`) of the given groups. */
async function memberIds(
  supabase: SupabaseClient<Database>,
  groupIds: readonly string[],
): Promise<Set<string>> {
  const members = new Set<string>();
  for (let i = 0; i < groupIds.length; i += EXPOSURE_CHUNK) {
    const { data } = await supabase
      .from('group_members')
      .select('user_id')
      // Only students practise; a teacher's membership in a shared group is the class view.
      .eq('role', 'member')
      .in('group_id', groupIds.slice(i, i + EXPOSURE_CHUNK));
    for (const row of dbRows(data)) members.add(row.user_id);
  }
  return members;
}

/**
 * How much of this assessment is still reachable by a student it does not target. Read with the
 * service role: the caller is the author, and the answer spans classes they cannot see.
 */
export async function assessExposure(
  assignmentId: string,
  targets: readonly Target[],
): Promise<ServiceResult<ExposureForecast>> {
  const supabase = createServiceClient();
  const empty: ExposureForecast = { openItemCount: 0, outsideStudentCount: 0 };

  const links = await supabase
    .from('assignment_questions')
    .select('question_id')
    .eq('assignment_id', assignmentId);
  if (links.error) return toDbFailure(links.error);
  const itemIds = dbRows(links.data).flatMap((row) => (row.question_id ? [row.question_id] : []));
  if (itemIds.length === 0) return success(empty);

  const targetGroupIds = [...new Set(targets.flatMap((t) => (t.group_id ? [t.group_id] : [])))];
  const cohort = new Set(targets.flatMap((t) => (t.student_id ? [t.student_id] : [])));
  for (const id of await memberIds(supabase, targetGroupIds)) cohort.add(id);

  const bankOf = new Map<string, string>();
  for (let i = 0; i < itemIds.length; i += EXPOSURE_CHUNK) {
    const { data, error } = await supabase
      .from('questions')
      .select('id, bank_id')
      .in('id', itemIds.slice(i, i + EXPOSURE_CHUNK));
    if (error) return toDbFailure(error);
    for (const row of dbRows(data)) bankOf.set(row.id, row.bank_id);
  }

  const bankIds = [...new Set(bankOf.values())];
  if (bankIds.length === 0) return success(empty);

  const groupsByBank = new Map<string, string[]>();
  for (let i = 0; i < bankIds.length; i += EXPOSURE_CHUNK) {
    const { data, error } = await supabase
      .from('bank_groups')
      .select('bank_id, group_id')
      .in('bank_id', bankIds.slice(i, i + EXPOSURE_CHUNK));
    if (error) return toDbFailure(error);
    for (const row of dbRows(data)) {
      const groups = groupsByBank.get(row.bank_id) ?? [];
      groups.push(row.group_id);
      groupsByBank.set(row.bank_id, groups);
    }
  }

  const outsideByBank = new Map<string, Set<string>>();
  const outsideStudents = new Set<string>();
  let openItemCount = 0;
  for (const bankId of bankOf.values()) {
    let outside = outsideByBank.get(bankId);
    if (!outside) {
      outside = new Set<string>();
      // A bank shared with no group is reachable only by its author: nothing is exposed.
      for (const id of await memberIds(supabase, groupsByBank.get(bankId) ?? [])) {
        if (!cohort.has(id)) outside.add(id);
      }
      outsideByBank.set(bankId, outside);
    }
    if (outside.size === 0) continue;
    openItemCount += 1;
    for (const id of outside) outsideStudents.add(id);
  }

  return success({ openItemCount, outsideStudentCount: outsideStudents.size });
}
