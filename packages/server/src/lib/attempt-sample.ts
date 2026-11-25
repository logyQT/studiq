import { type Rng, sample, shuffle } from '@studiq/server/lib/random';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { mapSupabaseError } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';

/**
 * The sample one attempt serves (#1174, R6/R7; #1172 revisited, R8/R9).
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
 *   is gone still burns the item). A retake draws from outside this set (#1174, R6/R7): the second
 *   attempt must not be a memory test of the first.
 * - `exposed` — every item with an **exposure event** for them: the review of this or another
 *   assessment, or practice, already rendered the key. Exposure is *information* — it feeds the
 *   ledger, the publish warning and fairness — and it excludes an item only for an assessment that
 *   opted into `unseen_only` (R8). A first attempt of a default assessment serves the whole pool.
 *
 * `taught_item` (R9) is the teacher's declaration that an item was taught; it only means anything
 * inside `unseen_only`, where it waives the pre-exposure penalty, and nothing else — the item stays
 * sealed during the window and its key is still withheld (R2/R4/R10).
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
  /** Items a retake must not repeat: served by an earlier attempt, or answered anywhere. */
  seen: Set<string>;
  /** Items whose key or explanation was rendered to this student (the exposure ledger). */
  exposed: Set<string>;
}

/** What one attempt must leave out of its pool. */
export interface SampleExclusion {
  /** Served or answered: the retake rule, which holds whatever the assessment's mode is. */
  seen: ReadonlySet<string>;
  /** Key-rendered: only an `unseenOnly` assessment excludes these. */
  exposed: ReadonlySet<string>;
}

/**
 * The history for one student on one assessment. `candidateIds` bounds the ledger read to the items
 * this assessment could serve, so the answer does not grow with the student's whole history.
 *
 * `seen` is global in one respect: an item the student **answered** anywhere is not fresh for them,
 * so the answer read spans every attempt of the student, not only this assessment's.
 */
export async function attemptHistory(
  studentId: string,
  assignmentId: string,
  candidateIds: readonly string[],
): Promise<ServiceResult<AttemptHistory>> {
  const supabase = createServiceClient();
  const served = new Set<string>();
  const seen = new Set<string>();
  const exposed = new Set<string>();

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
    const batch = candidateIds.slice(i, i + ITEM_CHUNK);
    const [answers, events] = await Promise.all([
      supabase
        .from('student_answers')
        .select('question_id, quiz_attempts!student_answers_attempt_id_fkey!inner(user_id)')
        .eq('quiz_attempts.user_id', studentId)
        .in('question_id', batch),
      supabase
        .from('exposure_events')
        .select('question_id')
        .eq('student_id', studentId)
        .in('question_id', batch),
    ]);
    if (answers.error) return mapSupabaseError(answers.error);
    if (events.error) return mapSupabaseError(events.error);

    for (const row of dbRows(answers.data)) if (row.question_id) seen.add(row.question_id);
    for (const row of dbRows(events.data)) exposed.add(row.question_id);
  }

  return success({ served, seen, exposed });
}

/**
 * The items an attempt may serve (#1172, R8/R9). `unseenOnly` is the assessment's mode:
 *
 * - off — only the retake rule applies: what this student already met inside this assessment (and
 *   answered anywhere) stays out, so a fresh sample is still disjoint (R6/R7). A key they saw
 *   elsewhere is information, not an exclusion. `taught_item` is inert here.
 * - on — the phase-3 rule, exactly: `seen` and `exposed` both exclude, and `taught_item` waives
 *   both, so a taught item is graded even though the class has met it (R9).
 *
 * A link without a question is kept: the caller already treats it as a corrupt state.
 */
export function sampleEligible<T extends { question_id: string | null; taught_item: boolean }>(
  links: readonly T[],
  exclusion: SampleExclusion,
  unseenOnly: boolean,
): T[] {
  return links.filter((link) => {
    if (!link.question_id) return true;
    if (unseenOnly && link.taught_item) return true;
    if (exclusion.seen.has(link.question_id)) return false;
    return !(unseenOnly && exclusion.exposed.has(link.question_id));
  });
}

/** The links whose item this student was already served — the same-item retake set. */
export function sampleServed<T extends { question_id: string | null }>(
  links: readonly T[],
  served: ReadonlySet<string>,
): T[] {
  return links.filter((link) => !!link.question_id && served.has(link.question_id));
}

/** The bucket for an item whose type is not known (a link without a snapshot). */
const UNKNOWN_TYPE = 'unknown';

/**
 * How many items each type contributes to a draw of `count` from a pool (#1295): proportional to
 * the pool's mix, so the draw matches the pool within one item per type.
 *
 * Every type gets its whole share; the seats left over are drawn **stochastically**, without
 * replacement, each type's chance proportional to the fraction it fell short by. A deterministic
 * largest-remainder seat went to the same type for every student, so a type that never had the
 * largest remainder was never served to anyone: `4 mcq + 1 open` with count 2 always drew two mcq,
 * and `40 open + 2 mcq` with count 10 always drew ten open, leaving the graded item unreachable.
 * Weighting by the remainder — rather than choosing uniformly — keeps the expected quota equal to
 * the type's share, so the mix stays proportional within one item per type, while a class's
 * attempts collectively cover every type.
 *
 * Only a fractional type can take a leftover seat, and a quota never exceeds its type's size: a
 * share is `size * count / total < size` because `count < total`, so a fractional type's floor
 * leaves room for its one extra seat.
 */
function stratifiedQuotas(sizes: readonly number[], count: number, rng: Rng): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const shares = sizes.map((size) => (size * count) / total);
  const quotas = shares.map((share) => Math.floor(share));
  let seats = count - quotas.reduce((sum, quota) => sum + quota, 0);

  const remaining = shares
    .map((share, index) => ({ index, weight: share - Math.floor(share) }))
    .filter((entry) => entry.weight > 0);

  while (seats > 0 && remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, entry) => sum + entry.weight, 0);
    let ticket = rng() * totalWeight;
    let pick = remaining.length - 1;
    for (const [index, entry] of remaining.entries()) {
      ticket -= entry.weight;
      if (ticket < 0) {
        pick = index;
        break;
      }
    }
    const chosen = remaining.splice(pick, 1)[0];
    if (!chosen) break;
    quotas[chosen.index] = (quotas[chosen.index] ?? 0) + 1;
    seats -= 1;
  }

  return quotas;
}

/**
 * One attempt's draw: `count` items from `pool`, or the whole pool when the teacher set no count.
 *
 * A subset is stratified by item type (#1295): two students in one class must not get ten open
 * items and ten true/false items respectively, because open items are ungraded today and the two
 * sheets would not measure the same thing. Each type contributes in proportion to its share of
 * `pool`: its whole share is guaranteed and the leftover seats are allocated stochastically, by
 * fractional remainder, so a small type is served to some students rather than to none. The items
 * inside a type are drawn uniformly (Fisher–Yates), and the result is shuffled so its order does
 * not reveal the types. An item whose type is unknown (`typeOf` returns nothing) forms a bucket of
 * its own.
 *
 * `pool` is whatever the caller already narrowed to: for a retake that is the items still eligible,
 * so the mix follows what is left rather than the original bound pool.
 */
export function drawStratifiedSample<T>(
  pool: readonly T[],
  count: number | null,
  typeOf: (item: T) => string | null | undefined,
  rng: Rng = Math.random,
): T[] {
  if (count === null || count >= pool.length) return [...pool];

  const buckets = new Map<string, T[]>();
  for (const item of pool) {
    const type = typeOf(item) ?? UNKNOWN_TYPE;
    const bucket = buckets.get(type);
    if (bucket) bucket.push(item);
    else buckets.set(type, [item]);
  }

  const groups = [...buckets.values()];
  const quotas = stratifiedQuotas(
    groups.map((group) => group.length),
    count,
    rng,
  );
  const drawn = groups.flatMap((group, index) => sample(group, quotas[index] ?? 0, rng));
  return shuffle(drawn, rng);
}
