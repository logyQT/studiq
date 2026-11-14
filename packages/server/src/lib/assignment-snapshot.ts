import type { SupabaseClient } from '@supabase/supabase-js';
import { type QuestionKey, readQuestionKeys } from '@studiq/server/lib/question-keys';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { Database } from '@studiq/server/types/database';

/**
 * The frozen assessment snapshot (#1171 slice 1b).
 *
 * `assignment_questions` carries two columns: `snapshot` (reader-safe content, selectable by
 * students) and `snapshot_key` (`explanation` + correct option ids). The key is never granted to
 * `authenticated`; only the server reads it, with the service role.
 *
 * Snapshot shape mirrors the reader question projection, so a payload does not change shape when
 * it comes from a snapshot instead of the live question.
 */

/** One option inside a frozen snapshot: content only, never `is_correct`. */
export interface SnapshotOption {
  id: string;
  content: string;
  order_index: number;
  match_group: string | null;
  match_side: string | null;
}

/** The reader-safe half of a frozen item. */
export interface QuestionSnapshot {
  id: string;
  content: string;
  type: string;
  question_answers: SnapshotOption[];
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

/**
 * Freezes every item of `assignmentId` from its live row, writing `snapshot`, `snapshot_key` and
 * `snapshot_version`. Called on the draft → published transition (and again on a later
 * republish), never while the assignment is already live — a re-write then would lift an edited
 * item into a running assessment. Idempotent: the same live row writes the same snapshot.
 */
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
