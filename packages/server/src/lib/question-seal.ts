import type { RequestContext } from '@studiq/authz';
import { effectiveCloseAt, isAssessmentClosed } from '@studiq/server/lib/assessment-close';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbNested, dbRows } from '@studiq/server/lib/supabase/rows';
import { mapSupabaseError, toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The derived item reservation (#1171, R1/R2/R14).
 *
 * There is no reservation table: an item is sealed for a **learner** while a published assessment
 * targets them and the clock is inside its window (`[start_time, effective close)`). "Learner" is
 * data, not persona (D-5e1): the caller is targeted directly, through a group they are a
 * `member` of, or by an org-wide run in an org whose role for them is a learner profile. The set is
 * computed here, with the service role, from the caller's own `ctx` — never from an id in a
 * request — and it never leaves the server: no client-callable function returns it, because a
 * learner who could read it would learn exactly which items their assessment holds (R14).
 */

/** The window a published assessment opens: a missing bound is an open end. */
export interface SealWindow {
  start_time?: string | null;
  deadline?: string | null;
  /** Written at the durable close (R7/R12); the deadline cannot reopen a closed run. */
  closed_at?: string | null;
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
  const closed = isAssessmentClosed(window, now);
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
 * The items sealed for the calling learner. Read with the service role because the caller may not
 * see the targets or items of another class — the seal exists precisely so they do not.
 *
 * The three target arms are the same ones `rls_caller_is_sealed_item` evaluates in SQL (D-5e1);
 * the two halves must agree, so both read `group_members.role` and
 * `org_members → org_roles.entitlement_profile` rather than the JWT persona.
 */
export async function sealedItemsFor(
  ctx: RequestContext,
  now: Date = new Date(),
): Promise<ServiceResult<Seal>> {
  const supabase = createServiceClient();
  const callerId = ctx.userId;

  // 1. The assignments that target this caller — directly, through one of their groups as a
  //    `member` (a group teacher is staff of that class, not a learner in it), or because the
  //    teacher sealed the run for the whole organisation and the caller's role there is a
  //    learner profile (R3).
  const [groups, direct, memberships] = await Promise.all([
    supabase.from('group_members').select('group_id').eq('user_id', callerId).eq('role', 'member'),
    supabase.from('assignment_targets').select('assignment_id').eq('student_id', callerId),
    supabase
      .from('org_members')
      .select('organization_id, org_roles(entitlement_profile)')
      .eq('user_id', callerId),
  ]);
  if (groups.error) return mapSupabaseError(groups.error);
  if (direct.error) return mapSupabaseError(direct.error);
  if (memberships.error) return mapSupabaseError(memberships.error);

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

  const learnerOrgIds = dbRows(memberships.data)
    .filter((row) => dbNested(row.org_roles)?.entitlement_profile === 'learner')
    .map((row) => row.organization_id);
  if (learnerOrgIds.length > 0) {
    const orgWide = await supabase
      .from('teacher_assignments')
      .select('id')
      .in('organization_id', learnerOrgIds)
      .eq('status', 'published')
      .eq('seal_org_wide', true);
    if (orgWide.error) return mapSupabaseError(orgWide.error);
    for (const row of dbRows(orgWide.data)) assignmentIds.add(row.id);
  }

  const candidateIds = [...assignmentIds].filter((id): id is string => !!id);
  if (candidateIds.length === 0) return success(emptySeal());

  // 2. Keep the published ones whose window is open — and the ones that already ended but still
  //    hold an item back from the review (R10) — and the items each of them binds.
  const assignments = await supabase
    .from('teacher_assignments')
    .select('id, start_time, deadline, closed_at')
    .in('id', candidateIds)
    .eq('status', 'published');
  if (assignments.error) return mapSupabaseError(assignments.error);

  const windows = dbRows(assignments.data);
  const started = (row: { start_time?: string | null }) =>
    !row.start_time || now.getTime() >= new Date(row.start_time).getTime();
  const live = windows.filter((row) => isWindowOpen(row, now));
  // A run that has not opened yet holds nothing: withholding only keeps an item past its close.
  const ended = windows.filter((row) => started(row) && !isWindowOpen(row, now));
  if (live.length === 0 && ended.length === 0) return success(emptySeal());

  const links = await supabase
    .from('assignment_questions')
    .select('assignment_id, question_id, withhold_from_review, released_at')
    .in(
      'assignment_id',
      windows.map((row) => row.id),
    );
  if (links.error) return mapSupabaseError(links.error);

  const liveIds = new Set(live.map((row) => row.id));
  const closeByAssignment = new Map(live.map((row) => [row.id, effectiveCloseAt(row)]));
  const seal = emptySeal();
  for (const link of dbRows(links.data)) {
    if (!link.question_id || !link.assignment_id) continue;
    const isLive = liveIds.has(link.assignment_id);
    // A closed window no longer holds its items, except the ones held back from its review: those
    // stay sealed until the teacher releases them, and then they have no date ("until released").
    const heldBack = link.withhold_from_review && !link.released_at;
    if (!isLive && !heldBack) continue;

    seal.ids.add(link.question_id);
    seal.closesAt.set(
      link.question_id,
      mergeClose(
        seal.closesAt.get(link.question_id),
        isLive ? (closeByAssignment.get(link.assignment_id) ?? null) : null,
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

/** The slice of a published run the learner predicate reads (D-5e1). */
export interface LearnerAssignment {
  organization_id?: string | null;
  seal_org_wide?: boolean | null;
  assignment_targets?: readonly { group_id?: string | null; student_id?: string | null }[] | null;
}

/**
 * The D-5e1 answer for one already-loaded assignment: is the caller a learner for it? The same
 * three arms `sealedItemsFor` computes set-wise and `rls_caller_is_sealed_item` evaluates in SQL
 * — direct target, group target with `group_members.role = 'member'`, org-wide with a
 * learner-profile org role. Used where only a yes/no is needed (the exposure write guard), so
 * there is one notion of "learner", not three.
 */
export async function callerIsLearnerOnAssignment(
  supabase: SupabaseClient<Database>,
  ctx: RequestContext,
  assignment: LearnerAssignment,
): Promise<ServiceResult<boolean>> {
  const targets = assignment.assignment_targets ?? [];

  // Arm 1: the run targets the caller directly.
  if (targets.some((target) => target.student_id === ctx.userId)) return success(true);

  // Arm 2: the run targets a group the caller is a `member` of (a group teacher is not).
  const targetGroupIds = [
    ...new Set(targets.map((target) => target.group_id).filter((id): id is string => !!id)),
  ];
  if (targetGroupIds.length > 0) {
    const { data, error } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', ctx.userId)
      .eq('role', 'member')
      .in('group_id', targetGroupIds);
    if (error) return toDbFailure(error);
    if (dbRows(data).length > 0) return success(true);
  }

  // Arm 3: the run is org-wide and the caller's role in the run's org is a learner profile.
  if (assignment.seal_org_wide && assignment.organization_id) {
    const { data, error } = await supabase
      .from('org_members')
      .select('org_roles(entitlement_profile)')
      .eq('organization_id', assignment.organization_id)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    if (error) return toDbFailure(error);
    if (dbNested(data?.org_roles)?.entitlement_profile === 'learner') return success(true);
  }

  return success(false);
}

/**
 * The sealed set for the calling learner. A caller no published assignment targets is not sealed:
 * the reservation is a property of the target set, not of the JWT persona, so an author composing
 * an item keeps seeing it and a targeted educator is held like any other learner (D-5e1).
 */
export async function sealFor(ctx: RequestContext): Promise<ServiceResult<Seal>> {
  return sealedItemsFor(ctx);
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
