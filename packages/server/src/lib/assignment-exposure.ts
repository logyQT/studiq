import type { SupabaseClient } from '@supabase/supabase-js';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import type { Database } from '@studiq/server/types/database';

/**
 * Exposure at publish: the two questions a teacher must answer before a run goes live.
 *
 * - Cross-class exposure (#1171, R3). An assessment seals its items for the classes it targets, so
 *   every other class that can still practise them is a decision the teacher has to make
 *   explicitly, not a warning they can dismiss. Reach is the app's own rule: a student practises an
 *   item because their group is shared the item's bank (`bank_groups`), which is what a reader's
 *   `question.read` group scope resolves to. An item is therefore exposed outside the cohort when a
 *   group shared that bank has a student outside it.
 * - Pre-exposure (#1172, R8/R9). A targeted student who already saw an item's key or answered it
 *   will not be served it, so the run grades fewer items than the teacher bound. The forecast counts
 *   that shortfall **before** publishing, per item and per class, so the teacher can declare the item
 *   taught instead of discovering it in the results.
 *
 * Both halves are counts only: no key content, and no student id. Item ids are returned for the
 * pre-exposure half because the teacher is looking at those items and the count is what they act on.
 */

/** `.in()` values travel in the request URL; ids are read in chunks. */
const EXPOSURE_CHUNK = 200;

/** One bound item and how many targeted students already met it. */
export interface ItemPreExposure {
  questionId: string;
  /** Targeted students whose ledger holds a key render for this item. */
  seenCount: number;
  /** Targeted students who already answered this item in an earlier attempt. */
  answeredCount: number;
}

/** One targeted class and how many of its students already met at least one bound item. */
export interface GroupPreExposure {
  groupId: string;
  studentCount: number;
}

export interface PreExposureForecast {
  /** Items at least one targeted student already met. */
  itemCount: number;
  /** Targeted students who already met at least one bound item. */
  studentCount: number;
  items: ItemPreExposure[];
  groups: GroupPreExposure[];
}

export interface ExposureForecast {
  /** Items in the assessment a student outside the cohort can still practise. */
  openItemCount: number;
  /** How many students outside the cohort can reach at least one of them. */
  outsideStudentCount: number;
  preExposure: PreExposureForecast;
}

interface Target {
  group_id: string | null;
  student_id: string | null;
}

/** Student members (`role = 'member'`) per group. */
async function membersByGroup(
  supabase: SupabaseClient<Database>,
  groupIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const members = new Map<string, Set<string>>();
  for (let i = 0; i < groupIds.length; i += EXPOSURE_CHUNK) {
    const { data } = await supabase
      .from('group_members')
      .select('user_id, group_id')
      // Only students practise; a teacher's membership in a shared group is the class view.
      .eq('role', 'member')
      .in('group_id', groupIds.slice(i, i + EXPOSURE_CHUNK));
    for (const row of dbRows(data)) {
      const group = members.get(row.group_id) ?? new Set<string>();
      group.add(row.user_id);
      members.set(row.group_id, group);
    }
  }
  return members;
}

/**
 * How many targeted students already met each bound item: a ledger event (the key was rendered) or
 * an earlier answer. Read with the service role — the caller is the author and the counts span
 * classes — and bounded to the cohort, so an outside student's history never enters the forecast.
 */
async function preExposure(
  supabase: SupabaseClient<Database>,
  itemIds: readonly string[],
  cohort: readonly string[],
): Promise<{ forecast: PreExposureForecast; met: Set<string> }> {
  const seenByItem = new Map<string, Set<string>>();
  const answeredByItem = new Map<string, Set<string>>();
  const met = new Set<string>();

  for (let i = 0; i < itemIds.length; i += EXPOSURE_CHUNK) {
    const items = itemIds.slice(i, i + EXPOSURE_CHUNK);
    for (let j = 0; j < cohort.length; j += EXPOSURE_CHUNK) {
      const students = cohort.slice(j, j + EXPOSURE_CHUNK);
      const [events, answers] = await Promise.all([
        supabase
          .from('exposure_events')
          .select('question_id, student_id')
          .in('question_id', items)
          .in('student_id', students),
        supabase
          .from('student_answers')
          .select('question_id, quiz_attempts!inner(user_id)')
          .in('question_id', items)
          .in('quiz_attempts.user_id', students),
      ]);
      for (const row of dbRows(events.data)) {
        const seen = seenByItem.get(row.question_id) ?? new Set<string>();
        seen.add(row.student_id);
        seenByItem.set(row.question_id, seen);
        met.add(row.student_id);
      }
      for (const row of dbRows(answers.data)) {
        const studentId = row.quiz_attempts.user_id;
        if (!row.question_id || !studentId) continue;
        const answered = answeredByItem.get(row.question_id) ?? new Set<string>();
        answered.add(studentId);
        answeredByItem.set(row.question_id, answered);
        met.add(studentId);
      }
    }
  }

  const items = itemIds.flatMap((questionId) => {
    const seenCount = seenByItem.get(questionId)?.size ?? 0;
    const answeredCount = answeredByItem.get(questionId)?.size ?? 0;
    return seenCount + answeredCount > 0 ? [{ questionId, seenCount, answeredCount }] : [];
  });

  return {
    forecast: {
      itemCount: items.length,
      studentCount: met.size,
      items,
      // The per-class half is filled by the caller, which knows the classes it targeted.
      groups: [],
    },
    met,
  };
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
  const empty: ExposureForecast = {
    openItemCount: 0,
    outsideStudentCount: 0,
    preExposure: { itemCount: 0, studentCount: 0, items: [], groups: [] },
  };

  const links = await supabase
    .from('assignment_questions')
    .select('question_id')
    .eq('assignment_id', assignmentId);
  if (links.error) return toDbFailure(links.error);
  const itemIds = dbRows(links.data).flatMap((row) => (row.question_id ? [row.question_id] : []));
  if (itemIds.length === 0) return success(empty);

  const targetGroupIds = [...new Set(targets.flatMap((t) => (t.group_id ? [t.group_id] : [])))];
  const members = await membersByGroup(supabase, targetGroupIds);
  const cohort = new Set(targets.flatMap((t) => (t.student_id ? [t.student_id] : [])));
  for (const group of members.values()) for (const id of group) cohort.add(id);

  const { forecast: pre, met } = await preExposure(supabase, itemIds, [...cohort]);
  // A class's share of the shortfall: its own members who met at least one bound item.
  pre.groups = targetGroupIds.flatMap((groupId) => {
    const membersOfGroup = members.get(groupId) ?? new Set<string>();
    const studentCount = [...met].filter((id) => membersOfGroup.has(id)).length;
    return studentCount > 0 ? [{ groupId, studentCount }] : [];
  });

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
      const shared = await membersByGroup(supabase, groupsByBank.get(bankId) ?? []);
      for (const group of shared.values()) {
        for (const id of group) if (!cohort.has(id)) outside.add(id);
      }
      outsideByBank.set(bankId, outside);
    }
    if (outside.size === 0) continue;
    openItemCount += 1;
    for (const id of outside) outsideStudents.add(id);
  }

  return success({ openItemCount, outsideStudentCount: outsideStudents.size, preExposure: pre });
}
