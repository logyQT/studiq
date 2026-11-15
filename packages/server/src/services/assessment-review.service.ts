import type { RequestContext } from '@studiq/authz';
import { loadTargetedAssignment } from '@studiq/server/lib/assignment-access';
import { readReviewItems } from '@studiq/server/lib/assignment-snapshot';
import { reviewState } from '@studiq/server/lib/assignment-visibility';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/**
 * The post-close review (#1171, R5/R10).
 *
 * The review is a cohort artefact: at the close it opens for every student the assessment targets,
 * including one who used no attempt and one whose attempt expired. It renders the **frozen** item
 * and the **published** key (`snapshot_key`), never the live question, and it leaves every item the
 * teacher holds back out entirely (R10). Before the close there is no review to read: the key would
 * be the answer sheet.
 */

/** One option of a reviewed item, with the key resolved from the frozen snapshot. */
export interface ReviewedOption {
  id: string;
  content: string;
  isCorrect: boolean;
}

/** One reviewed item: the frozen content, the published key and this student's own answer. */
export interface ReviewedItem {
  itemId: string;
  type: string;
  content: string;
  options: ReviewedOption[];
  explanation: string | null;
  /** `false` for open-text items: they have no automatic key and stay ungraded (R16). */
  graded: boolean;
  /** `null` when the item is ungraded or this student has no attempt. */
  correct: boolean | null;
  selectedOptionId: string | null;
  textAnswer: string | null;
  teacherPoints: number | null;
  teacherFeedback: string | null;
}

export interface AssignmentReview {
  assignmentId: string;
  /** The reviewed attempt; `null` for a cohort member who has no submitted attempt. */
  attemptId: string | null;
  completedAt: string | null;
  /** `null` when there is no attempt (the cohort still sees the key, not a score). */
  score: { earned: number; possible: number } | null;
  ungradedCount: number;
  items: ReviewedItem[];
}

interface AttemptRow {
  id: string;
  score: number;
  total_points: number | null;
  total_questions: number;
  completed_at: string | null;
}

interface AnswerRow {
  question_id: string | null;
  selected_option_id: string | null;
  text_answer: string | null;
  is_correct: boolean | null;
  teacher_points: number | null;
  teacher_feedback: string | null;
}

export class AssessmentReviewService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  /**
   * The assessment review for the calling student. `attemptId` selects one submitted attempt;
   * without it the latest submitted attempt is reviewed (ties broken by attempt id).
   */
  async review(
    assignmentId: string,
    attemptId: string | undefined,
    ctx: RequestContext,
  ): Promise<ServiceResult<AssignmentReview>> {
    const supabase = await this.clientFactory();

    // Targeting, plus the durable natural close: this read can be the one that records it.
    const loaded = await loadTargetedAssignment(supabase, assignmentId, ctx.userId);
    if (isFailure(loaded)) return loaded;
    const assignment = loaded.data;

    const state = reviewState(assignment);
    // No review exists at any time when the teacher did not opt in — a lock would reveal that one
    // could exist (R5).
    if (state === 'hidden') return failure('NOT_FOUND');
    if (state === 'locked') return failure('REVIEW_LOCKED');

    const attempt = await this.selectAttempt(supabase, assignmentId, attemptId, ctx.userId);
    if (isFailure(attempt)) return attempt;

    const reviewItems = await readReviewItems(assignmentId);
    if (isFailure(reviewItems)) return reviewItems;

    let answers = new Map<string, AnswerRow>();
    if (attempt.data) {
      const sheet = await this.readAnswers(supabase, attempt.data.id);
      if (isFailure(sheet)) return sheet;
      answers = sheet.data;
    }

    const items = reviewItems.data.map((item) => {
      const answer = answers.get(item.questionId);
      const graded = item.snapshot.type !== 'open';
      const correctOptionIds = new Set(item.key.correctOptionIds);
      return {
        itemId: item.questionId,
        type: item.snapshot.type,
        content: item.snapshot.content,
        options: item.snapshot.question_answers.map((option) => ({
          id: option.id,
          content: option.content,
          isCorrect: correctOptionIds.has(option.id),
        })),
        explanation: item.key.explanation,
        graded,
        // No attempt at all is not "wrong": the cohort reveal serves the key, not a verdict on a
        // student who never sat it (R5). A skipped item inside a real attempt is `false`.
        correct: graded ? (attempt.data ? (answer?.is_correct ?? false) : null) : null,
        selectedOptionId: answer?.selected_option_id ?? null,
        textAnswer: answer?.text_answer ?? null,
        teacherPoints: answer?.teacher_points ?? null,
        teacherFeedback: answer?.teacher_feedback ?? null,
      };
    });

    const chosen = attempt.data;
    return success({
      assignmentId,
      attemptId: chosen?.id ?? null,
      completedAt: chosen?.completed_at ?? null,
      score: chosen
        ? { earned: chosen.score, possible: chosen.total_points ?? chosen.total_questions }
        : null,
      ungradedCount: items.filter((item) => !item.graded).length,
      items,
    });
  }

  /** The named attempt (must be the caller's and submitted), or the latest submitted one. */
  private async selectAttempt(
    supabase: SupabaseClient<Database>,
    assignmentId: string,
    attemptId: string | undefined,
    userId: string,
  ): Promise<ServiceResult<AttemptRow | null>> {
    let query = supabase
      .from('quiz_attempts')
      .select('id, score, total_points, total_questions, completed_at')
      .eq('assignment_id', assignmentId)
      .eq('user_id', userId)
      .not('completed_at', 'is', null);
    if (attemptId) query = query.eq('id', attemptId);

    // Latest submitted attempt; the id tie-break keeps the choice stable.
    const { data, error } = await query
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1);

    if (error) return toDbFailure(error);
    const [attempt] = dbRows(data);
    // A named attempt that is not the caller's submitted attempt is indistinguishable from a
    // missing one.
    if (attemptId && !attempt) return failure('NOT_FOUND');
    return success(attempt ?? null);
  }

  /** The caller's own answer sheet for one submitted attempt. */
  private async readAnswers(
    supabase: SupabaseClient<Database>,
    attemptId: string,
  ): Promise<ServiceResult<Map<string, AnswerRow>>> {
    const { data, error } = await supabase
      .from('student_answers')
      .select(
        'question_id, selected_option_id, text_answer, is_correct, teacher_points, teacher_feedback',
      )
      .eq('attempt_id', attemptId);

    if (error) return toDbFailure(error);

    const answers = new Map<string, AnswerRow>();
    for (const row of dbRows(data)) {
      if (row.question_id) answers.set(row.question_id, row);
    }
    return success(answers);
  }
}

export const assessmentReviewService = wrapService(
  new AssessmentReviewService(createClient),
  'assessment-review.service',
);
