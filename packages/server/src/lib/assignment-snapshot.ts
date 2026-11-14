import type { SupabaseClient } from '@supabase/supabase-js';
import { QUESTION_PAYLOAD_SELECT } from '@studiq/server/lib/question-view';
import type { QuestionKey } from '@studiq/server/lib/question-keys';
import { readQuestionKeys } from '@studiq/server/lib/question-keys';
import { isRecord } from '@studiq/server/lib/record';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbNested, dbRows } from '@studiq/server/lib/supabase/rows';
import { mapSupabaseError, toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import type { Database } from '@studiq/server/types/database';

/**
 * The frozen assessment snapshot (#1171). `snapshot` is reader-safe; `snapshot_key` is never
 * granted to `authenticated` and only this module reads it, with the service role.
 */

/** One option inside a frozen snapshot: content only, never `is_correct`. */
export interface SnapshotOption {
  id: string;
  content: string;
  order_index: number;
  match_group: string | null;
  match_side: string | null;
}

/** The reader-safe half of a frozen item; a snapshot read also carries its published version. */
export interface QuestionSnapshot {
  id: string;
  content: string;
  type: string;
  question_answers: SnapshotOption[];
  snapshot_version?: number | null;
}

/** The published key: one explanation and the option ids that were correct at publish. */
export type QuestionSnapshotKey = QuestionKey;

/** The link columns every assignment read may select (never `snapshot_key`, never `*`). */
export const ASSIGNMENT_QUESTION_COLUMNS =
  'id, assignment_id, question_id, order_index, points, snapshot, snapshot_version';

/** The live item projected for a snapshot write. */
const OPTION_SELECT = 'id, content, order_index, match_group, match_side';
const LIVE_SNAPSHOT_SELECT =
  `id, content, type, version, question_answers:question_options(${OPTION_SELECT})` as const;

function readOption(value: unknown): SnapshotOption | null {
  if (!isRecord(value)) return null;
  const { id, content, order_index, match_group, match_side } = value;
  if (typeof id !== 'string' || typeof content !== 'string' || typeof order_index !== 'number') {
    return null;
  }
  return {
    id,
    content,
    order_index,
    match_group: typeof match_group === 'string' ? match_group : null,
    match_side: typeof match_side === 'string' ? match_side : null,
  };
}

/** Narrows a `jsonb` snapshot column; malformed is `null`, and the caller decides. */
export function snapshotFromJson(value: unknown): QuestionSnapshot | null {
  if (!isRecord(value)) return null;
  const { id, content, type, question_answers } = value;
  if (typeof id !== 'string' || typeof content !== 'string' || typeof type !== 'string') {
    return null;
  }
  return {
    id,
    content,
    type,
    question_answers: (Array.isArray(question_answers) ? question_answers : []).flatMap(
      (option) => {
        const parsed = readOption(option);
        return parsed ? [parsed] : [];
      },
    ),
  };
}

/** Reader-safe snapshots of one assignment, keyed by question id (RLS-scoped). */
export async function readAssignmentSnapshots(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
): Promise<ServiceResult<Map<string, QuestionSnapshot>>> {
  const { data, error } = await supabase
    .from('assignment_questions')
    .select('question_id, snapshot, snapshot_version')
    .eq('assignment_id', assignmentId);

  if (error) return toDbFailure(error);

  const snapshots = new Map<string, QuestionSnapshot>();
  for (const row of dbRows(data)) {
    const snapshot = snapshotFromJson(row.snapshot);
    if (snapshot && row.question_id) {
      snapshots.set(row.question_id, { ...snapshot, snapshot_version: row.snapshot_version });
    }
  }
  return success(snapshots);
}

/** The published keys of one assignment (service role; the caller already proved ownership). */
export async function readAssignmentSnapshotKeys(
  assignmentId: string,
): Promise<Map<string, QuestionSnapshotKey>> {
  const keys = new Map<string, QuestionSnapshotKey>();
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('assignment_questions')
    .select('question_id, snapshot_key')
    .eq('assignment_id', assignmentId);

  if (error) return mapSupabaseError(error);

  for (const row of dbRows(data)) {
    const key = row.snapshot_key;
    if (!row.question_id || !isRecord(key)) continue;
    const correctOptionIds = Array.isArray(key.correctOptionIds)
      ? key.correctOptionIds.filter((id): id is string => typeof id === 'string')
      : [];
    keys.set(row.question_id, {
      explanation: typeof key.explanation === 'string' ? key.explanation : null,
      correctOptionIds,
    });
  }
  return keys;
}

/** Freezes every item at the draft → published transition; never while already live. */
export async function writeAssignmentSnapshots(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
): Promise<ServiceResult<number>> {
  const { data: links, error: linkError } = await supabase
    .from('assignment_questions')
    .select('id, question_id')
    .eq('assignment_id', assignmentId);

  if (linkError) return toDbFailure(linkError);

  const questionIds = [
    ...new Set(dbRows(links).flatMap((link) => (link.question_id ? [link.question_id] : []))),
  ];
  if (questionIds.length === 0) return success(0);

  const { data: questions, error: questionError } = await supabase
    .from('questions')
    .select(LIVE_SNAPSHOT_SELECT)
    .in('id', questionIds);

  if (questionError) return toDbFailure(questionError);

  const live = new Map(dbRows(questions).map((question) => [question.id, question]));
  const keys = await readQuestionKeys(questionIds);

  let written = 0;
  for (const link of dbRows(links)) {
    const question = link.question_id ? live.get(link.question_id) : undefined;
    if (!question) continue;

    const key = keys.get(question.id);
    const { error } = await supabase
      .from('assignment_questions')
      .update({
        snapshot: {
          id: question.id,
          content: question.content,
          type: question.type,
          question_answers: dbRows(question.question_answers).map((option) => ({
            ...option,
          })),
        },
        snapshot_key: {
          explanation: key?.explanation ?? null,
          correctOptionIds: key?.correctOptionIds ?? [],
        },
        snapshot_version: question.version,
      })
      .eq('id', link.id);

    if (error) return toDbFailure(error);
    written += 1;
  }

  return success(written);
}

/**
 * The question payload of one attempt, in its own order: an assignment reads its frozen snapshots,
 * practice the live item. A published link without a snapshot is a corrupt state and is skipped.
 */
export async function readAttemptQuestions(
  supabase: SupabaseClient<Database>,
  attempt: { id: string; assignment_id: string | null },
): Promise<ServiceResult<QuestionSnapshot[]>> {
  if (attempt.assignment_id) {
    const { data, error } = await supabase
      .from('quiz_attempt_questions')
      .select('question_id')
      .eq('attempt_id', attempt.id)
      .order('order_index', { ascending: true });

    if (error) return toDbFailure(error);

    const snapshots = await readAssignmentSnapshots(supabase, attempt.assignment_id);
    if (!snapshots.success) return snapshots;

    return success(
      dbRows(data).flatMap((row) => {
        const frozen = row.question_id ? snapshots.data.get(row.question_id) : undefined;
        return frozen ? [frozen] : [];
      }),
    );
  }

  const { data, error } = await supabase
    .from('quiz_attempt_questions')
    .select(`order_index, question_id, questions(${QUESTION_PAYLOAD_SELECT})`)
    .eq('attempt_id', attempt.id)
    .order('order_index', { ascending: true });

  if (error) return toDbFailure(error);

  return success(
    dbRows(data).flatMap((row) => {
      const question = dbNested(row.questions);
      return question ? [question] : [];
    }),
  );
}
