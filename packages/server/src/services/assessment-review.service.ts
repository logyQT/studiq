import { AccountType, type RequestContext } from '@studiq/authz';
import { loadTargetedAssignment } from '@studiq/server/lib/assignment-access';
import {
  readReviewItems,
  readServedQuestionIds,
  type ReviewItem,
} from '@studiq/server/lib/assignment-snapshot';
import { reviewState } from '@studiq/server/lib/assignment-visibility';
import { recordReviewExposure } from '@studiq/server/lib/exposure-ledger';
import { wrapService } from '@studiq/server/lib/observability';
import { carriesAnswerKey } from '@studiq/server/lib/question-keys';
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
  /** The choice item's teaching artefact (R16); `null` for an open item. */
  explanation: string | null;
  /**
   * The open item's teaching artefact. `null` on a snapshot published before #1173 — the review
   * says the model answer was not captured instead of rendering an empty box (R11: a frozen
   * snapshot is never re-derived from the live item).
   */
  modelAnswer: string | null;
  /** `false` for open-text items: they have no automatic key and stay ungraded (R16). */
  graded: boolean;
  /** `null` when the item is ungraded or this student has no attempt. */
  correct: boolean | null;
  selectedOptionId: string | null;
  textAnswer: string | null;
  teacherPoints: number | null;
  teacherFeedback: string | null;
}

/** One submitted attempt as the review index shows it: its own score and its own ungraded count. */
export interface AttemptReviewSummary {
  attemptId: string;
  completedAt: string | null;
  /** `null` when the attempt holds only ungraded items (R16), never `0 out of 0`. */
  score: { earned: number; possible: number } | null;
  /** Items of *this* attempt that have no automatic key (R16). */
  ungradedCount: number;
}

export interface AssignmentReview {
  assignmentId: string;
  /** The reviewed attempt; `null` for a cohort member who has no submitted attempt. */
  attemptId: string | null;
  completedAt: string | null;
  /** `null` when there is no attempt, or when the attempt holds only ungraded items (R16). */
  score: { earned: number; possible: number } | null;
  /**
   * Items of the reviewed attempt that have no automatic key (R16) — the same set `score` is
   * computed from, not the whole sheet. `0` when there is no attempt.
   */
  ungradedCount: number;
  /** The cohort reveal: every item the assessment holds, whichever attempt was reviewed. */
  items: ReviewedItem[];
  /**
   * Every submitted attempt this student has on the assessment, latest first (tie-break by id), so
   * a retake can be read against the one before it (R5/R19). `[]` when they sat none.
   */
  attempts: AttemptReviewSummary[];
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

/**
 * The open items (R16) among the items one attempt was served. Both the headline count and the
 * per-attempt index use this, so a partially served attempt reports only what it held (#1257).
 */
function countUngraded(
  served: ReadonlySet<string> | null,
  reviewItems: readonly ReviewItem[],
): number {
  if (!served) return 0;
  return reviewItems.filter((item) => item.snapshot.type === 'open' && served.has(item.questionId))
    .length;
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

    // The review is the cohort reveal, so it renders the whole assessment; what changes per attempt
    // is the **verdict**. A retake is served a different sample (R7), so an item this attempt never
    // saw has no verdict for it (`null`) — only an item it was served and skipped is `false`.
    const served = attempt.data ? await readServedQuestionIds(supabase, attempt.data.id) : null;
    if (served && isFailure(served)) return served;

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
        modelAnswer: item.key.modelAnswer,
        graded,
        // No attempt at all is not "wrong": the cohort reveal serves the key, not a verdict on a
        // student who never sat it (R5). An item the attempt was **served** and skipped is `false`;
        // an item it was never served (a fresh-sample retake draws its own) has no verdict at all.
        correct:
          graded && attempt.data && served?.data.has(item.questionId)
            ? (answer?.is_correct ?? false)
            : null,
        selectedOptionId: answer?.selected_option_id ?? null,
        textAnswer: answer?.text_answer ?? null,
        teacherPoints: answer?.teacher_points ?? null,
        teacherFeedback: answer?.teacher_feedback ?? null,
      };
    });

    const chosen = attempt.data;

    // R8: this render is the exposure. A repeat read conflicts on the unique (student, item) row and
    // adds nothing; a failed write is a server fault, not a reason to withhold the review.
    // Only a student's render is an exposure: a teacher previewing the cohort review is not a
    // learner who has now seen the key, and a staff row in the ledger would be a false event for
    // phase 3's eligibility (#1172). An item whose review carries no key artefact burns nothing.
    if (ctx.accountType === AccountType.STUDENT) {
      const exposed = await recordReviewExposure({
        studentId: ctx.userId,
        assignmentId,
        questionIds: reviewItems.data
          .filter((item) => carriesAnswerKey(item.key))
          .map((item) => item.questionId),
      });
      if (isFailure(exposed)) return exposed;
    }

    // R16: an open item is ungraded and outside the denominator, so a sheet of open items has no
    // score at all — `null`, never `0` out of `0`. The denominator is the one frozen on the
    // attempt (graded items only), so it cannot drift with a later edit.
    const possible = chosen ? (chosen.total_points ?? chosen.total_questions) : 0;

    // R5/R19: earlier attempts are part of the review, each with its own score and its own
    // ungraded count — a retake never overwrites the previous verdict.
    const history = await this.reviewedAttempts(
      supabase,
      assignmentId,
      ctx.userId,
      reviewItems.data,
    );
    if (isFailure(history)) return history;

    return success({
      assignmentId,
      attemptId: chosen?.id ?? null,
      completedAt: chosen?.completed_at ?? null,
      score: chosen && possible > 0 ? { earned: chosen.score, possible } : null,
      // The headline describes the same attempt as `score`: an attempt served a subset of the
      // pool (R7) cannot report the open items it never saw (#1257).
      ungradedCount: countUngraded(served ? served.data : null, reviewItems.data),
      items,
      attempts: history.data,
    });
  }

  /**
   * Every submitted attempt of the caller on this assessment, newest first. The per-attempt ungraded
   * count is computed from what that attempt was **served** and what the review can grade, so an
   * earlier attempt keeps its own denominator and its own ungraded count after a retake.
   */
  private async reviewedAttempts(
    supabase: SupabaseClient<Database>,
    assignmentId: string,
    userId: string,
    reviewItems: readonly ReviewItem[],
  ): Promise<ServiceResult<AttemptReviewSummary[]>> {
    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('id, score, total_points, total_questions, completed_at')
      .eq('assignment_id', assignmentId)
      .eq('user_id', userId)
      .not('completed_at', 'is', null)
      .order('started_at', { ascending: false })
      .order('id', { ascending: false });

    if (error) return toDbFailure(error);
    const attempts = dbRows(data);
    if (attempts.length === 0) return success([]);

    const { data: served, error: servedError } = await supabase
      .from('quiz_attempt_questions')
      .select('attempt_id, question_id')
      .in(
        'attempt_id',
        attempts.map((attempt) => attempt.id),
      );

    if (servedError) return toDbFailure(servedError);

    const servedByAttempt = new Map<string, Set<string>>();
    for (const row of dbRows(served)) {
      if (!row.attempt_id || !row.question_id) continue;
      const ids = servedByAttempt.get(row.attempt_id) ?? new Set<string>();
      ids.add(row.question_id);
      servedByAttempt.set(row.attempt_id, ids);
    }

    return success(
      attempts.map((attempt) => {
        const items = servedByAttempt.get(attempt.id) ?? new Set<string>();
        const possible = attempt.total_points ?? attempt.total_questions;
        return {
          attemptId: attempt.id,
          completedAt: attempt.completed_at,
          score: possible > 0 ? { earned: attempt.score, possible } : null,
          ungradedCount: countUngraded(items, reviewItems),
        };
      }),
    );
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
