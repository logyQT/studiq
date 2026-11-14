import { AccountType, type RequestContext } from '@studiq/authz';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { mapSupabaseError } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';

/**
 * The derived item reservation (#1171, R1/R2/R14).
 *
 * There is no reservation table: an item is sealed for a student while a **published** assessment
 * targets them (directly or through one of their groups) and the clock is inside its window
 * (`[start_time, effective close)`). The set is computed here, with the service role, from the
 * caller's own `ctx` — never from an id in a request — and it never leaves the server: no
 * client-callable function returns it, because a student who could read it would learn exactly
 * which items their assessment holds (R14).
 */

/** The window a published assessment opens: a missing bound is an open end. */
export interface SealWindow {
  start_time?: string | null;
  deadline?: string | null;
}

/** Everything the reader paths need to subtract held items and to render the R14 notice. */
export interface Seal {
  /** Ids sealed for this student right now. */
  ids: Set<string>;
  /** Item id → its bank, so a bank payload can count its own held items. */
  bankId: Map<string, string | null>;
  /** Item id → the latest close among the windows holding it; `null` = no dated release yet. */
  closesAt: Map<string, string | null>;
}

/** The bank-payload notice (R14). `heldCount > 0 && heldUntil === null` reads "until released". */
export interface HeldNotice {
  heldCount: number;
  heldUntil: string | null;
}

/** PostgREST `.in()` values travel in the URL; ids are read in chunks below the gateway limit. */
const SEAL_CHUNK = 200;

/** Whether `now` is inside a window: `[start, close)`, with a missing bound left open. */
export function isWindowOpen(window: SealWindow, now: Date): boolean {
  const started = !window.start_time || now.getTime() >= new Date(window.start_time).getTime();
  const closed = !!window.deadline && now.getTime() >= new Date(window.deadline).getTime();
  return started && !closed;
}

export function emptySeal(): Seal {
  return { ids: new Set(), bankId: new Map(), closesAt: new Map() };
}

/**
 * The latest dated close of an item held by several windows. A window without a close (or a
 * withheld item in slice 3) leaves the item without a date, so the notice says "until released"
 * instead of showing a date that has already passed.
 */
function mergeClose(previous: string | null | undefined, next: string | null): string | null {
  if (previous === undefined) return next;
  if (previous === null || next === null) return null;
  return next > previous ? next : previous;
}

/**
 * The items sealed for one student. Read with the service role because the caller may not see the
 * targets or items of another class — the seal exists precisely so they do not.
 */
export async function sealedItemsFor(
  studentId: string,
  now: Date = new Date(),
): Promise<ServiceResult<Seal>> {
  const supabase = createServiceClient();

  // 1. The assignments that target this student: directly, or through one of their groups.
  const [groups, direct] = await Promise.all([
    supabase.from('group_members').select('group_id').eq('user_id', studentId),
    supabase.from('assignment_targets').select('assignment_id').eq('student_id', studentId),
  ]);
  if (groups.error) return mapSupabaseError(groups.error);
  if (direct.error) return mapSupabaseError(direct.error);

  const groupIds = dbRows(groups.data).map((row) => row.group_id);
  const assignmentIds = new Set(dbRows(direct.data).map((row) => row.assignment_id));

  if (groupIds.length > 0) {
    const grouped = await supabase
      .from('assignment_targets')
      .select('assignment_id')
      .in('group_id', groupIds);
    if (grouped.error) return mapSupabaseError(grouped.error);
    for (const row of dbRows(grouped.data)) assignmentIds.add(row.assignment_id);
  }

  const candidateIds = [...assignmentIds].filter((id): id is string => !!id);
  if (candidateIds.length === 0) return success(emptySeal());

  // 2. Keep the published ones whose window is open, and the items each of them binds.
  const assignments = await supabase
    .from('teacher_assignments')
    .select('id, start_time, deadline')
    .in('id', candidateIds)
    .eq('status', 'published');
  if (assignments.error) return mapSupabaseError(assignments.error);

  const open = dbRows(assignments.data).filter((row) => isWindowOpen(row, now));
  if (open.length === 0) return success(emptySeal());

  const links = await supabase
    .from('assignment_questions')
    .select('assignment_id, question_id')
    .in(
      'assignment_id',
      open.map((row) => row.id),
    );
  if (links.error) return mapSupabaseError(links.error);

  const closeByAssignment = new Map(open.map((row) => [row.id, row.deadline ?? null]));
  const seal = emptySeal();
  for (const link of dbRows(links.data)) {
    if (!link.question_id || !link.assignment_id) continue;
    seal.ids.add(link.question_id);
    seal.closesAt.set(
      link.question_id,
      mergeClose(
        seal.closesAt.get(link.question_id),
        closeByAssignment.get(link.assignment_id) ?? null,
      ),
    );
  }
  if (seal.ids.size === 0) return success(seal);

  // 3. The sealed item's bank, for the per-bank notice.
  const questionIds = [...seal.ids];
  for (let i = 0; i < questionIds.length; i += SEAL_CHUNK) {
    const questions = await supabase
      .from('questions')
      .select('id, bank_id')
      .in('id', questionIds.slice(i, i + SEAL_CHUNK));
    if (questions.error) return mapSupabaseError(questions.error);
    for (const row of dbRows(questions.data)) seal.bankId.set(row.id, row.bank_id);
  }

  return success(seal);
}

/**
 * The sealed set for the calling student. Staff get an empty seal: the reservation is a property of
 * a student's own assignment window, and an author must keep seeing the items they are composing.
 */
export async function sealFor(ctx: RequestContext): Promise<ServiceResult<Seal>> {
  if (ctx.accountType !== AccountType.STUDENT) return success(emptySeal());
  return sealedItemsFor(ctx.userId);
}

/** `(id,id,…)` for a `.not('id', 'in', …)` filter, or `null` when nothing is sealed. */
export function sealedIdFilter(seal: Seal): string | null {
  if (seal.ids.size === 0) return null;
  return `(${[...seal.ids].join(',')})`;
}

/** The R14 notice for one bank: how many of its items are held, and until when. */
export function heldNotice(seal: Seal, bankId: string): HeldNotice {
  let heldCount = 0;
  let heldUntil: string | null = null;
  for (const itemId of seal.ids) {
    if (seal.bankId.get(itemId) !== bankId) continue;
    heldCount += 1;
    const closesAt = seal.closesAt.get(itemId) ?? null;
    if (closesAt && (!heldUntil || closesAt > heldUntil)) heldUntil = closesAt;
  }
  return { heldCount, heldUntil: heldCount > 0 ? heldUntil : null };
}
