import type { RequestContext } from '@studiq/authz';
import {
  type AssignmentLink,
  ASSIGNMENT_QUESTION_COLUMNS,
  type QuestionSnapshot,
  readAssignmentLinks,
  readAssignmentSnapshotKeys,
  readAssignmentSnapshots,
  readAttemptQuestions,
  readServedQuestionIds,
  snapshotFromJson,
  writeAssignmentSnapshots,
} from '@studiq/server/lib/assignment-snapshot';
import { loadTargetedAssignment } from '@studiq/server/lib/assignment-access';
import {
  attemptHistory,
  drawSample,
  sampleEligible,
  sampleServed,
} from '@studiq/server/lib/attempt-sample';
import { assessExposure } from '@studiq/server/lib/assignment-exposure';
import { assessPreExposure } from '@studiq/server/lib/assignment-preexposure';
import {
  FAIRNESS_MIN_RESPONDENTS,
  type FairnessItem,
  fairnessItem,
} from '@studiq/server/lib/fairness';
import {
  type AssessmentWindow,
  ensureClosed,
  expireInProgressAttempts,
  isAssessmentClosed,
  isAssessmentLive,
} from '@studiq/server/lib/assessment-close';
import { wrapService } from '@studiq/server/lib/observability';
import { openQuestionIds } from '@studiq/server/lib/question-status';
import { insertAssessmentItemLinks } from '@studiq/server/lib/quiz-assignment';
import { readQuestionKeys, withAnswerKey } from '@studiq/server/lib/question-keys';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { createClient } from '@studiq/server/lib/supabase/server';
import { dbNested, dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import {
  type AddQuestionsInput,
  type CreateTeacherAssignmentInput,
  type GradeAnswerInput,
  type PublishAssignmentInput,
  PublishableAssignmentSchema,
  type RandomizeInput,
  type ReorderQuestionsInput,
  type SetTargetsInput,
  type UpdateTeacherAssignmentInput,
} from '@studiq/server/models/teacher-assignment.model';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import {
  type Notifier,
  noopNotifier,
  notificationService,
} from '@studiq/server/services/notification.service';

/**
 * The `draft_answers` column is only ever served through
 * `GET /api/v1/quiz/:attemptId`, which maps it to `answers` (#349). The start
 * payload never serialises the raw column, so both payload shapes stay equal.
 */
function toAttemptPayload<T extends { draft_answers?: unknown }>(
  attempt: T,
): Omit<T, 'draft_answers'> {
  const { draft_answers: _draftAnswers, ...attemptFields } = attempt;
  return attemptFields;
}

/**
 * `.in()` values travel in the request URL, so target lists are checked in chunks instead of
 * one request that a large class would push over the gateway's URL limit.
 */
const TARGET_CHUNK = 200;

/**
 * Columns shared by the student list and detail attempt payloads. Explicit
 * columns keep `draft_answers` out of the read path (#349).
 */
const STUDENT_ATTEMPT_SELECT =
  'assignment_id, id, score, total_questions, total_points, completed_at, expired_at, started_at';

type QuizAttemptRow = Database['public']['Tables']['quiz_attempts']['Row'];

/** A run the caller may write, with the client that proved they may. */
interface OwnedWindow {
  supabase: SupabaseClient<Database>;
  run: {
    id: string;
    status: string;
    start_time: string | null;
    deadline: string | null;
    closed_at: string | null;
  };
}

/** The slice of a `quiz_attempts` row `STUDENT_ATTEMPT_SELECT` projects. */
type StudentAttemptSummaryRow = Pick<
  Database['public']['Tables']['quiz_attempts']['Row'],
  | 'assignment_id'
  | 'id'
  | 'score'
  | 'total_questions'
  | 'total_points'
  | 'completed_at'
  | 'expired_at'
  | 'started_at'
>;

export type AnswersExportStatus = 'graded' | 'submitted' | 'in_progress';

/** One row of the results view, as serialised by the answers CSV export. */
export interface AnswersExportRow {
  studentName: string | null;
  email: string | null;
  /** `3/4`, or `-` when the attempt is not completed. */
  score: string;
  status: AnswersExportStatus;
  /** ISO timestamp; the route formats it for the requested locale. */
  completedAt: string | null;
}

/**
 * PostgREST returns a to-one relation as an object, while the generated types
 * describe it as an array. Accept both so the mapping matches what the API
 * actually returns.
 */
function joinOne<T>(value: T | T[] | null | undefined): T | null {
  const related = Array.isArray(value) ? value[0] : value;
  return related ?? null;
}

/**
 * Whether a published run has opened. Living inside the window is derived from the clock — there is
 * no extra enum value — so a run with no `start_time` is live from the moment it is published.
 */
function isLiveRun(run: { status?: string; start_time?: string | null }, now: Date): boolean {
  if (run.status !== 'published') return false;
  return !run.start_time || now.getTime() >= new Date(run.start_time).getTime();
}

/**
 * The two deadline edits a teacher may not make (R12/R20, #1191). A close at or before the window's
 * own start is not a window; and on a **live** run the new close must be in the future, because a
 * close at or before `now` ends the run — that is the explicit close, which records `closed_at`,
 * expires running attempts and reveals deliberately. A shrink to a future instant is a normal
 * correction and stays allowed, and draft/scheduled runs keep free editing (their close is still
 * bound by the start rule above).
 */
function deadlineRefusal(
  run: AssessmentWindow,
  deadline: string,
  now: Date,
): ServiceResult<never> | null {
  const at = new Date(deadline).getTime();
  if (run.start_time && at <= new Date(run.start_time).getTime()) {
    return failure('UNPROCESSABLE_ENTITY', [
      { code: 'custom', path: ['deadline'], message: ValidationErrorCode.INVALID_INPUT },
    ]);
  }
  if (isAssessmentLive(run, now) && at <= now.getTime()) {
    return failure('UNPROCESSABLE_ENTITY', [
      { code: 'custom', path: ['deadline'], message: ValidationErrorCode.DEADLINE_END_IS_CLOSE },
    ]);
  }
  return null;
}

/** The fairness block of the results payload (R9): counts only, taught items excluded. */
export interface FairnessReport {
  respondents: number;
  minRespondents: number;
  items: FairnessItem[];
}

/** Adds `student` to `index[questionId]`, creating the set on first use. */
function addToIndex(index: Map<string, Set<string>>, questionId: string, student: string): void {
  const set = index.get(questionId) ?? new Set<string>();
  set.add(student);
  index.set(questionId, set);
}

/**
 * The published option's text for one answer row. A skipped answer and an open answer both have no
 * selected option, so they resolve to `null` and the caller renders „Brak odpowiedzi”.
 */
function selectedOptionContent(
  snapshots: Map<string, QuestionSnapshot>,
  answer: { question_id: string | null; selected_option_id: string | null },
): string | null {
  if (!answer.question_id || !answer.selected_option_id) return null;
  const frozen = snapshots.get(answer.question_id);
  return (
    frozen?.question_answers.find((option) => option.id === answer.selected_option_id)?.content ??
    null
  );
}

export class TeacherAssignmentService {
  constructor(
    private clientFactory: () => Promise<SupabaseClient<Database>>,
    /** Tells students about a published assignment and a first grade; none in unit tests. */
    private notifier: Notifier = noopNotifier,
  ) {}

  async create(
    data: CreateTeacherAssignmentInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    // A quiz copy is a new binding, and it is chosen as a whole: if any item is retired or
    // deleted the whole copy is refused. Silently dropping it would create an assessment with a
    // different item set than the quiz the teacher picked (#1171).
    const quizQuestions: Array<{
      question_id: string;
      order_index: number | null;
      points: number;
    }> = [];
    if (data.quizId) {
      const { data: rows, error: quizError } = await supabase
        .from('quiz_questions')
        .select('question_id, order_index, points')
        .eq('quiz_id', data.quizId)
        .order('order_index', { ascending: true });

      if (quizError) return toDbFailure(quizError);

      for (const row of dbRows(rows)) {
        if (row.question_id) {
          quizQuestions.push({
            question_id: row.question_id,
            order_index: row.order_index,
            points: row.points,
          });
        }
      }

      const open = await openQuestionIds(
        supabase,
        quizQuestions.map((question) => question.question_id),
      );
      if (isFailure(open)) return open;
      if (open.data.size !== quizQuestions.length) return failure('UNPROCESSABLE_ENTITY');
    }

    const insertData: Database['public']['Tables']['teacher_assignments']['Insert'] = {
      organization_id: ctx.activeOrgId,
      created_by: ctx.userId,
      title: data.title,
      description: data.description,
      deadline: data.deadline,
      time_limit_min: data.timeLimitMin,
      shuffle_questions: data.shuffleQuestions,
      shuffle_answers: data.shuffleAnswers,
      show_results: data.showResults,
      max_attempts: data.maxAttempts,
      allow_same_item_retake: data.allowSameItemRetake,
      unseen_only: data.unseenOnly,
      attempt_item_count: data.attemptItemCount,
      passing_score: data.passingScore,
    };

    if (data.quizId) {
      insertData.quiz_id = data.quizId;
    }

    const { data: assignment, error } = await supabase
      .from('teacher_assignments')
      .insert(insertData)
      .select()
      .single();

    if (error) return toDbFailure(error);

    // Copy the validated quiz items (every one of them was open above).
    const copied = await insertAssessmentItemLinks(supabase, assignment.id, quizQuestions);
    if (isFailure(copied)) return copied;

    // Re-fetch with questions. Explicit columns: `assignment_questions.*` would include the
    // revoked `snapshot_key`.
    const { data: full, error: refetchError } = await supabase
      .from('teacher_assignments')
      .select(`*, assignment_questions(${ASSIGNMENT_QUESTION_COLUMNS})`)
      .eq('id', assignment.id)
      .single();

    if (refetchError) return toDbFailure(refetchError);
    return success(full);
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const { data: assignment, error } = await supabase
      .from('teacher_assignments')
      .select(
        // Explicit question columns: `question_id(*)` would ask for the revoked `model_answer`
        // (#1173) and `explanation` (#1180), and fail closed (42501) instead of serving the
        // composer. The key reader adds both back below.
        `*, assignment_targets(group_id, student_id), assignment_questions(${ASSIGNMENT_QUESTION_COLUMNS}, question:question_id(id, bank_id, organization_id, created_by, type, content, status, version, visibility, created_at, updated_at, question_answers:question_options(id, content, order_index, match_group, match_side)))`,
      )
      .eq('id', id)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!assignment) return failure('NOT_FOUND');

    if (assignment.created_by !== ctx.userId) {
      const scope = ctx.permissionScopes['assignment.read'];
      if (scope !== 'organization') return failure('FORBIDDEN');
      if (assignment.organization_id !== ctx.activeOrgId) return failure('FORBIDDEN');
    }

    const rows = dbRows(assignment.assignment_questions);
    // A published assessment serves its frozen snapshot (R11); draft is the live composer.
    const isPublished = assignment.status !== 'draft';

    let assignmentQuestions;
    if (isPublished) {
      const snapshots = await readAssignmentSnapshots(id);
      if (isFailure(snapshots)) return snapshots;
      const keys = await readAssignmentSnapshotKeys(id);
      assignmentQuestions = rows.map((row) => {
        const frozen = row.question_id ? snapshots.data.get(row.question_id) : undefined;
        return {
          ...row,
          question: frozen ? withAnswerKey(frozen, keys.get(frozen.id)) : null,
        };
      });
    } else {
      const live = rows.flatMap((row) => {
        const question = dbNested(row.question);
        return question ? [question] : [];
      });
      const keys = await readQuestionKeys(live.map((question) => question.id));
      assignmentQuestions = rows.map((row) => {
        const question = dbNested(row.question);
        return {
          ...row,
          question: question ? withAnswerKey(question, keys.get(question.id)) : null,
        };
      });
    }

    // The composer needs the cross-class forecast to render the blocking acknowledgement (R3). A
    // published run cannot be re-published, so only the draft pays for it.
    const exposure = isPublished
      ? null
      : await assessExposure(id, dbRows(assignment.assignment_targets));
    if (exposure && isFailure(exposure)) return exposure;

    // R8: publishing is the last moment a teacher can declare an item taught, so the draft carries
    // what each targeted class has already seen. Information, not a refusal — R3 owns the blocking
    // decision.
    const preExposure = isPublished
      ? null
      : await assessPreExposure(id, dbRows(assignment.assignment_targets));
    if (preExposure && isFailure(preExposure)) return preExposure;

    return success({
      ...assignment,
      assignment_questions: assignmentQuestions,
      ...(exposure?.success ? { exposure: exposure.data } : {}),
      ...(preExposure?.success ? { preExposure: preExposure.data } : {}),
    });
  }

  async list(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const scope = ctx.permissionScopes['assignment.read'];

    let query = supabase
      .from('teacher_assignments')
      .select('*')
      .order('created_at', { ascending: false });

    if (scope === 'organization' && ctx.activeOrgId) {
      query = query.eq('organization_id', ctx.activeOrgId);
    } else {
      query = query.eq('created_by', ctx.userId);
    }

    const { data, error } = await query;
    if (error) return toDbFailure(error);
    return success(dbRows(data));
  }

  async update(
    id: string,
    data: UpdateTeacherAssignmentInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    // The deadline is a window bound, not a close (#1191). Settling a run whose clock has already
    // run out first makes the edit inert on it instead of a reopen; then the two edits that are not
    // a correction are refused, naming the field so the composer can point at it.
    if (data.deadline !== undefined) {
      const window = await this.loadCloseWindow(supabase, id);
      if (isFailure(window)) return window;
      const settled = await ensureClosed(window.data);
      if (isFailure(settled)) return settled;
      const refused = deadlineRefusal(settled.data, data.deadline, new Date());
      if (refused) return refused;
    }

    // The sampling mode is frozen at publish, like the item flags it changes (R8): flipping it on a
    // live run would rewrite the samples of students who have not started yet. Re-sending the value
    // the run already has — what the edit form does on every save — is not a change.
    if (data.unseenOnly !== undefined) {
      const { data: current, error: currentError } = await supabase
        .from('teacher_assignments')
        .select('status, unseen_only')
        .eq('id', id)
        .maybeSingle();
      if (currentError) return toDbFailure(currentError);
      if (!current) return failure('NOT_FOUND');
      if (current.status !== 'draft' && current.unseen_only !== data.unseenOnly) {
        return failure('ASSESSMENT_LIVE');
      }
    }

    const updateData: Database['public']['Tables']['teacher_assignments']['Update'] = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.deadline !== undefined) updateData.deadline = data.deadline;
    if (data.timeLimitMin !== undefined) updateData.time_limit_min = data.timeLimitMin;
    if (data.shuffleQuestions !== undefined) updateData.shuffle_questions = data.shuffleQuestions;
    if (data.shuffleAnswers !== undefined) updateData.shuffle_answers = data.shuffleAnswers;
    if (data.showResults !== undefined) updateData.show_results = data.showResults;
    if (data.maxAttempts !== undefined) updateData.max_attempts = data.maxAttempts;
    if (data.allowSameItemRetake !== undefined) {
      updateData.allow_same_item_retake = data.allowSameItemRetake;
    }
    if (data.unseenOnly !== undefined) updateData.unseen_only = data.unseenOnly;
    if (data.attemptItemCount !== undefined) {
      updateData.attempt_item_count = data.attemptItemCount;
    }
    if (data.passingScore !== undefined) updateData.passing_score = data.passingScore;
    updateData.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('teacher_assignments')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) return toDbFailure(error);
    return success(updated);
  }

  async delete(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    const { error } = await supabase.from('teacher_assignments').delete().eq('id', id);
    if (error) return toDbFailure(error);
    return success(null);
  }

  /**
   * Withdraws a **scheduled** run back to draft (R12): nothing is live yet, so no exposure exists
   * and the window or item set can be corrected. Once the window has opened the run is live and
   * withdraw is refused — publish-once applies from live.
   */
  async unpublish(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    const { data: assignment, error: fetchError } = await supabase
      .from('teacher_assignments')
      .select('status, start_time')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) return toDbFailure(fetchError);
    if (!assignment) return failure('NOT_FOUND');
    if (assignment.status !== 'published') return failure('BAD_REQUEST');
    if (isLiveRun(assignment, new Date())) return failure('ASSESSMENT_LIVE');

    const { data: updated, error } = await supabase
      .from('teacher_assignments')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return toDbFailure(error);
    return success(updated);
  }

  /**
   * Ends a live run now (R7/R12): `closed_at := now`, in-progress attempts expire and are consumed,
   * and the reservations end (withheld items keep theirs — R10). Staff only: the author or an org
   * manager, the same rule that owns every other write here.
   *
   * Closing is once: a second call answers `409 ASSESSMENT_CLOSED` instead of moving the instant,
   * and a run that never opened is `409 ASSESSMENT_NOT_LIVE` — cancelling a scheduled run is not a
   * close. Reopening is impossible by design; the repair path is a new assessment.
   */
  async close(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const loaded = await this.loadOwnedCloseWindow(id, ctx);
    if (isFailure(loaded)) return loaded;
    const { supabase, run: assignment } = loaded.data;

    if (assignment.status === 'cancelled') return failure('ASSESSMENT_CANCELLED');
    if (assignment.status !== 'published') return failure('ASSESSMENT_NOT_PUBLISHED');
    if (assignment.closed_at) return failure('ASSESSMENT_CLOSED');

    const now = new Date();
    if (assignment.start_time && now < new Date(assignment.start_time)) {
      return failure('ASSESSMENT_NOT_LIVE');
    }

    const closed = await this.stampClose(supabase, id, now, {});
    if (isFailure(closed)) return closed;
    return success(closed.data);
  }

  /**
   * Cancels a published run — scheduled or live (R12/R19). It is the ending that does **not** reveal:
   * the run stops, its in-progress attempts expire (consumed, unsubmittable), its reservations end,
   * and no review exists at any time (`reviewState` reads the cancelled status). Cancelling a closed
   * run is refused — the cohort already read the key, so that would be an un-reveal (R20) — and the
   * status is terminal in the database, so nothing can revive it.
   */
  async cancel(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const open = await this.loadOpenWindow(id, ctx);
    if (isFailure(open)) return open;
    const { supabase } = open.data;

    const cancelled = await this.stampClose(supabase, id, new Date(), { status: 'cancelled' });
    if (isFailure(cancelled)) return cancelled;
    return success(cancelled.data);
  }

  /**
   * Moves `closesAt` later, before the close (R12). Extending delays the reveal for the **whole
   * cohort** — there is no per-student extension, which is what keeps one window and one reveal — and
   * it can only move forward: shortening a window is the manager override (R20), and an extension
   * that shrinks would be a silent early reveal.
   *
   * A run that already closed cannot be extended: reopening is impossible, and the repair path is a
   * new assessment (makeup) over items with no exposure for the student.
   */
  async extend(id: string, closesAt: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const open = await this.loadOpenWindow(id, ctx);
    if (isFailure(open)) return open;
    const { supabase, run } = open.data;

    const current = run.deadline ? new Date(run.deadline).getTime() : null;
    if (current !== null && new Date(closesAt).getTime() <= current) {
      return failure('UNPROCESSABLE_ENTITY', [
        {
          code: 'custom',
          path: ['closesAt'],
          message: ValidationErrorCode.INVALID_INPUT,
        },
      ]);
    }

    // Closed between the read and the write: the extension must not land on a revealed run.
    const updated = await this.writeWindow(supabase, id, {
      deadline: closesAt,
      updated_at: new Date().toISOString(),
    });
    if (isFailure(updated)) return updated;
    return success(updated.data);
  }

  /**
   * The manager override (R20): move either bound of the window, in either direction, on a published
   * run. It exists for the cases the teacher paths cannot express — a shrink, a start moved, a late
   * correction — and it stops exactly where the seal is: it **never unseals a live class and never
   * un-reveals**. A shrink to a future instant is allowed (the cohort learns earlier, together); an
   * override that would end the seal now, or move the start past now, is refused with
   * `409 ASSESSMENT_LIVE`; a closed or cancelled run is refused outright, because both already
   * released their items.
   */
  async override(
    id: string,
    input: { closesAt?: string; opensAt?: string },
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const open = await this.loadOpenWindow(id, ctx);
    if (isFailure(open)) return open;
    const { supabase, run } = open.data;

    const now = new Date();
    const closesAt = input.closesAt ?? run.deadline ?? null;
    const opensAt = input.opensAt ?? run.start_time ?? null;

    if (!closesAt) {
      return failure('UNPROCESSABLE_ENTITY', [
        { code: 'custom', path: ['closesAt'], message: ValidationErrorCode.REQUIRED },
      ]);
    }
    if (opensAt && new Date(opensAt).getTime() >= new Date(closesAt).getTime()) {
      return failure('UNPROCESSABLE_ENTITY', [
        { code: 'custom', path: ['opensAt'], message: ValidationErrorCode.INVALID_INPUT },
      ]);
    }

    // The window already opened: anything that moves the seal's edge to `now` or behind it would
    // hand a live class its key early, or release items it is still being assessed on. The state is
    // the run's **current** one — a proposed start in the future is exactly the move being refused.
    const liveNow = !run.start_time || now.getTime() >= new Date(run.start_time).getTime();
    if (liveNow) {
      const endsSeal = new Date(closesAt).getTime() <= now.getTime();
      const movesStartAhead =
        input.opensAt !== undefined && new Date(input.opensAt).getTime() > now.getTime();
      if (endsSeal || movesStartAhead) return failure('ASSESSMENT_LIVE');
    }

    const updated = await this.writeWindow(supabase, id, {
      deadline: closesAt,
      start_time: opensAt,
      updated_at: now.toISOString(),
    });
    if (isFailure(updated)) return updated;
    return success(updated.data);
  }

  /**
   * Holds one item back from the cohort review (R10). The decision belongs to the live window: after
   * the close the cohort has already read the key, so hiding an item then would be an un-reveal
   * (R20) — the only action left is `releaseItem`.
   */
  async setReviewHold(
    id: string,
    questionId: string,
    withheld: boolean,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const loaded = await this.loadOwnedCloseWindow(id, ctx);
    if (isFailure(loaded)) return loaded;
    const { supabase, run } = loaded.data;

    if (run.status !== 'published') return failure('ASSESSMENT_NOT_PUBLISHED');
    if (isAssessmentClosed(run)) return failure('ASSESSMENT_CLOSED');

    const written = await this.writeItemFlag(supabase, id, questionId, {
      withhold_from_review: withheld,
      released_at: null,
    });
    if (isFailure(written)) return written;
    if (!written.data) return failure('NOT_FOUND');
    return success({ withhold_from_review: withheld });
  }

  /**
   * The cohort's counts per item (R9): who was served it, who got it right, what had no automatic
   * verdict. Taught items are labelled and excluded, cells under five respondents are suppressed,
   * and nothing is option-level — a distribution would be the key.
   */
  private async fairness(
    id: string,
    supabase: SupabaseClient<Database>,
  ): Promise<ServiceResult<FairnessReport>> {
    const links = await readAssignmentLinks(id);
    if (isFailure(links)) return links;

    const { data: attempts, error } = await supabase
      .from('quiz_attempts')
      .select('id, user_id')
      .eq('assignment_id', id)
      .not('completed_at', 'is', null);
    if (error) return toDbFailure(error);

    const attemptRows = dbRows(attempts);
    const studentOf = new Map(
      attemptRows.flatMap((attempt) => (attempt.user_id ? [[attempt.id, attempt.user_id]] : [])),
    );
    const respondents = new Set(studentOf.values());

    // Distinct students, so a retake never counts twice in one cell.
    const servedBy = new Map<string, Set<string>>();
    const correctBy = new Map<string, Set<string>>();
    if (attemptRows.length > 0) {
      const attemptIds = attemptRows.map((attempt) => attempt.id);
      const [servedRows, answerRows] = await Promise.all([
        supabase
          .from('quiz_attempt_questions')
          .select('attempt_id, question_id')
          .in('attempt_id', attemptIds),
        supabase
          .from('student_answers')
          .select('attempt_id, question_id, is_correct')
          .in('attempt_id', attemptIds),
      ]);
      if (servedRows.error) return toDbFailure(servedRows.error);
      if (answerRows.error) return toDbFailure(answerRows.error);

      for (const row of dbRows(servedRows.data)) {
        const student = row.attempt_id ? studentOf.get(row.attempt_id) : undefined;
        if (row.question_id && student) addToIndex(servedBy, row.question_id, student);
      }
      for (const row of dbRows(answerRows.data)) {
        const student = row.attempt_id ? studentOf.get(row.attempt_id) : undefined;
        if (row.question_id && student && row.is_correct) {
          addToIndex(correctBy, row.question_id, student);
        }
      }
    }

    const items = links.data.flatMap((link) => {
      if (!link.question_id) return [];
      const served = servedBy.get(link.question_id)?.size ?? 0;
      return [
        fairnessItem({
          questionId: link.question_id,
          taughtItem: link.taught_item,
          served,
          correct: correctBy.get(link.question_id)?.size ?? 0,
          // An open item has no automatic verdict, so every served student is ungraded (R16).
          ungraded: link.snapshot?.type === 'open' ? served : 0,
        }),
      ];
    });

    return success({
      respondents: respondents.size,
      minRespondents: FAIRNESS_MIN_RESPONDENTS,
      items,
    });
  }

  /**
   * Declares one item taught (R9): a ledger event or a prior answer no longer excludes it from this
   * student's sample, the item is labelled in results, and fairness statistics leave it out.
   *
   * Declared on a draft and frozen with the published snapshot: moving the flag after publish would
   * change a live sample mid-window and rewrite fairness after the cohort sat it.
   */
  async setTaughtItem(
    id: string,
    questionId: string,
    taught: boolean,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const editable = await this.draftClient(id, ctx);
    if (isFailure(editable)) return editable;

    const written = await this.writeItemFlag(editable.data, id, questionId, {
      taught_item: taught,
    });
    if (isFailure(written)) return written;
    if (!written.data) return failure('NOT_FOUND');
    return success({ taught_item: taught });
  }

  /**
   * One flag on one assessment item, through a client whose caller already proved the run is theirs
   * and in the right state. `false` means the item is not bound to this assessment.
   */
  private async writeItemFlag(
    supabase: SupabaseClient<Database>,
    id: string,
    questionId: string,
    patch: Database['public']['Tables']['assignment_questions']['Update'],
  ): Promise<ServiceResult<boolean>> {
    const { data, error } = await supabase
      .from('assignment_questions')
      .update(patch)
      .eq('assignment_id', id)
      .eq('question_id', questionId)
      .select('id')
      .maybeSingle();

    if (error) return toDbFailure(error);
    return success(Boolean(data));
  }

  /**
   * Releases a held-back item: it becomes visible in the review and practiceable again (R10).
   * Releasing something that was never held back is a refusal, not a silent success.
   */
  async releaseItem(
    id: string,
    questionId: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    const { data: link, error } = await supabase
      .from('assignment_questions')
      .select('id, withhold_from_review, released_at')
      .eq('assignment_id', id)
      .eq('question_id', questionId)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!link) return failure('NOT_FOUND');
    if (!link.withhold_from_review || link.released_at) return failure('RELEASE_NOT_WITHHELD');

    const releasedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('assignment_questions')
      .update({ released_at: releasedAt })
      .eq('id', link.id);

    if (updateError) return toDbFailure(updateError);
    return success({ released_at: releasedAt });
  }

  /**
   * Publishes a draft (R3/R12): the configuration is validated first (`422` with a field path per
   * problem), then cross-class exposure is either acknowledged or sealed away, and only then does
   * the status flip. Publishing an already-published run is refused — a scheduled run is corrected
   * by withdrawing it to draft, a live one cannot be corrected at all.
   */
  async publish(
    id: string,
    input: PublishAssignmentInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    const { data: before, error: beforeError } = await supabase
      .from('teacher_assignments')
      .select('status, start_time, deadline, max_attempts, organization_id')
      .eq('id', id)
      .single();

    if (beforeError) return toDbFailure(beforeError);

    const [targets, items] = await Promise.all([
      supabase.from('assignment_targets').select('group_id, student_id').eq('assignment_id', id),
      supabase.from('assignment_questions').select('question_id').eq('assignment_id', id),
    ]);
    if (targets.error) return toDbFailure(targets.error);
    if (items.error) return toDbFailure(items.error);

    const deadline = input.deadline ?? before.deadline ?? undefined;
    const startTime = input.startTime ?? before.start_time ?? undefined;

    const config = PublishableAssignmentSchema.safeParse({
      targets: dbRows(targets.data),
      items: dbRows(items.data),
      deadline,
      startTime,
      maxAttempts: before.max_attempts,
    });
    if (!config.success) return failure('UNPROCESSABLE_ENTITY', config.error.issues);

    // Publish-once applies from live: a scheduled run has no exposure yet, but it is still
    // published — withdraw it to draft to change it. A cancelled run is terminal: publishing it
    // again would serve an assessment whose items were released and whose attempts expired.
    if (before.status === 'cancelled') return failure('ASSESSMENT_CANCELLED');
    if (before.status === 'published') return failure('ASSESSMENT_ALREADY_PUBLISHED');

    // Sealing for the whole organisation leaves nothing exposed, so the forecast is only needed for
    // the per-class default.
    if (!input.sealOrgWide) {
      const exposure = await assessExposure(id, dbRows(targets.data));
      if (isFailure(exposure)) return exposure;
      if (exposure.data.openItemCount > 0 && !input.acknowledgeExposure) {
        return failure('EXPOSURE_ACK_REQUIRED');
      }
    }

    // Freeze before the status flips: a publish that cannot write every snapshot must not leave
    // a live assessment with nothing to serve.
    const snapshot = await writeAssignmentSnapshots(supabase, id);
    if (isFailure(snapshot)) return snapshot;

    const { data: updated, error } = await supabase
      .from('teacher_assignments')
      .update({
        status: 'published',
        deadline,
        start_time: startTime ?? null,
        seal_org_wide: input.sealOrgWide,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return toDbFailure(error);

    await this.notifier.assignmentPublished({ assignmentId: id, teacherId: ctx.userId });
    return success(updated);
  }

  async addQuestions(
    id: string,
    data: AddQuestionsInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const editable = await this.draftClient(id, ctx);
    if (isFailure(editable)) return editable;
    const supabase = editable.data;

    const existingIds = await this.existingQuestionIds(supabase, id);
    if (!existingIds.success) return existingIds;

    const newIds = data.questionIds.filter((qid) => !existingIds.data.has(qid));

    if (newIds.length === 0) return success({ added: 0 });

    // Composing an assessment is a new binding: a retired item may not be added, and a deleted
    // one is not bindable at all.
    const open = await openQuestionIds(supabase, newIds);
    if (isFailure(open)) return open;
    if (open.data.size !== newIds.length) return failure('UNPROCESSABLE_ENTITY');

    const rows = await this.nextQuestionLinks(supabase, id, newIds);

    const { error } = await supabase.from('assignment_questions').insert(rows);
    if (error) return toDbFailure(error);

    return success({ added: newIds.length });
  }

  async removeQuestion(
    id: string,
    questionId: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const editable = await this.draftClient(id, ctx);
    if (isFailure(editable)) return editable;
    const supabase = editable.data;

    const { error } = await supabase
      .from('assignment_questions')
      .delete()
      .eq('assignment_id', id)
      .eq('question_id', questionId);

    if (error) return toDbFailure(error);
    return success(null);
  }

  async reorderQuestions(
    id: string,
    data: ReorderQuestionsInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    const updates = data.questionIds.map((questionId, index) => ({
      assignment_id: id,
      question_id: questionId,
      order_index: index,
    }));

    for (const update of updates) {
      const { error } = await supabase
        .from('assignment_questions')
        .update({ order_index: update.order_index })
        .eq('assignment_id', update.assignment_id)
        .eq('question_id', update.question_id);

      if (error) return toDbFailure(error);
    }

    return success(null);
  }

  async randomize(
    id: string,
    data: RandomizeInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const editable = await this.draftClient(id, ctx);
    if (isFailure(editable)) return editable;
    const supabase = editable.data;

    let query = supabase.from('questions').select('id');

    // Pool = the active org's questions ∪ my own. Without an active org there is no tenant half,
    // and interpolating null yields `organization_id.eq.null` → 22P02 → 500 (#148). Personal
    // teacher assignments (organization_id NULL) are a supported scope, so the caller's own
    // questions remain a valid source.
    if (ctx.activeOrgId) {
      query = query.or(`organization_id.eq.${ctx.activeOrgId},created_by.eq.${ctx.userId}`);
    } else {
      query = query.eq('created_by', ctx.userId);
    }

    if (data.source === 'bank' && data.sourceId) {
      query = query.eq('bank_id', data.sourceId);
    } else if (data.source === 'topic' && data.sourceId) {
      const { data: topicQuestionIds } = await supabase
        .from('question_topic_assignments')
        .select('question_id')
        .eq('topic_id', data.sourceId);

      const ids = topicQuestionIds?.map((t) => t.question_id) ?? [];
      if (ids.length === 0) return success({ added: 0 });
      query = query.in('id', ids);
    }

    if (data.types && data.types.length > 0) {
      query = query.in('type', data.types);
    }

    // Randomize is composition: only open items can be newly bound (#1171).
    query = query.eq('status', 'open');

    const existingIds = await this.existingQuestionIds(supabase, id);
    if (!existingIds.success) return existingIds;

    const { data: allQuestions, error: fetchError } = await query;
    if (fetchError) return toDbFailure(fetchError);

    const available = dbRows(allQuestions).filter((q) => !existingIds.data.has(q.id));
    if (available.length === 0) return success({ added: 0 });

    const shuffled = [...available].toSorted(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(data.count, shuffled.length));

    const rows = await this.nextQuestionLinks(
      supabase,
      id,
      selected.flatMap((q) => (q.id ? [q.id] : [])),
    );

    const { error: insertError } = await supabase.from('assignment_questions').insert(rows);

    if (insertError) return toDbFailure(insertError);
    return success({ added: selected.length });
  }

  /**
   * Link rows for newly bound items, appended after the highest current `order_index`. Both
   * composing paths (hand-picked and randomized) share the ordering rule.
   */
  private async nextQuestionLinks(
    supabase: SupabaseClient<Database>,
    assignmentId: string,
    questionIds: readonly string[],
  ): Promise<Array<{ assignment_id: string; question_id: string; order_index: number }>> {
    const { data: maxOrder } = await supabase
      .from('assignment_questions')
      .select('order_index')
      .eq('assignment_id', assignmentId)
      .order('order_index', { ascending: false })
      .limit(1);

    const nextOrder = (maxOrder?.[0]?.order_index ?? -1) + 1;
    return questionIds.map((questionId, index) => ({
      assignment_id: assignmentId,
      question_id: questionId,
      order_index: nextOrder + index,
    }));
  }

  async setTargets(
    id: string,
    data: SetTargetsInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    // A published run's cohort is frozen (R20): dropping a class would unseal it mid-window, and
    // an empty list would withdraw the run through the draft branch below. A scheduled run is
    // re-targeted by withdrawing it to draft first (R12).
    const { data: assignment, error: statusError } = await supabase
      .from('teacher_assignments')
      .select('status')
      .eq('id', id)
      .maybeSingle();

    if (statusError) return toDbFailure(statusError);
    if (!assignment) return failure('NOT_FOUND');
    if (assignment.status === 'published') return failure('ASSESSMENT_LIVE');

    // Every target must belong to the assignment's organisation: the ids come from the request,
    // and notifications and results are fanned out from them (#235).
    const foreign = await this.hasForeignTargets(supabase, id, data, ctx);
    if (foreign) return failure('BAD_REQUEST');

    await supabase.from('assignment_targets').delete().eq('assignment_id', id);

    const rows: Array<{
      assignment_id: string;
      group_id?: string;
      student_id?: string;
    }> = [];

    if (data.groupIds) {
      for (const groupId of data.groupIds) {
        rows.push({ assignment_id: id, group_id: groupId });
      }
    }
    if (data.studentIds) {
      for (const studentId of data.studentIds) {
        rows.push({ assignment_id: id, student_id: studentId });
      }
    }

    if (rows.length > 0) {
      const { error } = await supabase.from('assignment_targets').insert(rows);
      if (error) return toDbFailure(error);
    } else {
      await supabase
        .from('teacher_assignments')
        .update({ status: 'draft', updated_at: new Date().toISOString() })
        .eq('id', id);
    }

    return success(null);
  }

  /**
   * The results list feeds two surfaces: the table, and the per-question grading
   * view (`/edu/assignments/:id/results/question/:qId`), which grades every
   * student's answer for one question. The answer rows therefore travel with the
   * attempt, in the same shape `getStudentAnswers` returns (#1230), plus the
   * published option's text — the card prints the option, never its id (#1238).
   */
  async getResults(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    const { data: attempts, error } = await supabase
      .from('quiz_attempts')
      .select(
        '*, user:user_id(id, email, full_name), quiz_answers:student_answers(*), assignment_answer_images(*)',
      )
      .eq('assignment_id', id)
      .order('started_at', { ascending: false });

    if (error) return toDbFailure(error);

    const fairness = await this.fairness(id, supabase);
    if (isFailure(fairness)) return fairness;

    // The grading card prints the option's text, and an answer row carries only
    // `selected_option_id` (#1238). Resolve it from the frozen snapshot: the live item may have
    // been edited after publish (R11).
    const snapshots = await readAssignmentSnapshots(id);
    if (isFailure(snapshots)) return snapshots;

    return success({
      attempts: dbRows(attempts).map((attempt) => ({
        ...attempt,
        quiz_answers: dbRows(attempt.quiz_answers).map((answer) => ({
          ...answer,
          selected_option_content: selectedOptionContent(snapshots.data, answer),
        })),
      })),
      fairness: fairness.data,
    });
  }

  /**
   * The grading route addresses the attempt, not the student: `max_attempts`
   * allows several attempts per `(assignment, user)`, so that pair is not a
   * unique key (#1062).
   */
  async getStudentAnswers(
    id: string,
    attemptId: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    const { data: attempt, error } = await supabase
      .from('quiz_attempts')
      .select(
        '*, quiz_attempt_questions(*), quiz_answers:student_answers(*), assignment_answer_images(*)',
      )
      .eq('id', attemptId)
      .eq('assignment_id', id)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!attempt) return failure('NOT_FOUND');

    const maxPoints = await this.loadAssignmentPoints(supabase, id);
    if (isFailure(maxPoints)) return maxPoints;

    // Grading renders the published item and its key, never the edited live row.
    const snapshots = await readAssignmentSnapshots(id);
    if (isFailure(snapshots)) return snapshots;
    const keys = await readAssignmentSnapshotKeys(id);

    return success({
      ...attempt,
      quiz_attempt_questions: dbRows(attempt.quiz_attempt_questions).map((q) => {
        const frozen = q.question_id ? snapshots.data.get(q.question_id) : undefined;
        return {
          ...q,
          question: frozen
            ? withAnswerKey(frozen, q.question_id ? keys.get(q.question_id) : undefined)
            : null,
          max_points: maxPoints.data.get(q.question_id)?.points ?? null,
        };
      }),
    });
  }

  async gradeAnswer(
    id: string,
    attemptId: string,
    data: GradeAnswerInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('id, graded_at, user_id')
      .eq('id', attemptId)
      .eq('assignment_id', id)
      .maybeSingle();

    if (attemptError) return toDbFailure(attemptError);
    if (!attempt?.user_id) return failure('NOT_FOUND');
    const firstGrade = !attempt.graded_at;

    // The bound is per question (`assignment_questions.points`), so it cannot
    // live in the Zod schema. Reject before writing: points above the maximum
    // used to be persisted and inflated the attempt score (#169).
    const maxPoints = await this.loadAssignmentPoints(supabase, id);
    if (isFailure(maxPoints)) return maxPoints;

    // Only an item this attempt was served can be graded: a pool item it never sat has no answer
    // to award and no place in its denominator (#1298). This also closes the forged-question-id
    // hole for the whole pool, not just for questions outside the assignment (#169).
    const served = await readServedQuestionIds(supabase, attempt.id);
    if (isFailure(served)) return served;

    const questionMax = served.data.has(data.questionId)
      ? maxPoints.data.get(data.questionId)?.points
      : undefined;
    if (questionMax === undefined) return failure('NOT_FOUND');
    if (data.points > questionMax) return failure('UNPROCESSABLE_ENTITY');

    const { data: existingAnswer } = await supabase
      .from('student_answers')
      .select('id')
      .eq('attempt_id', attempt.id)
      .eq('question_id', data.questionId)
      .single();

    if (existingAnswer) {
      const { error } = await supabase
        .from('student_answers')
        .update({
          is_correct: data.points > 0,
          teacher_points: data.points,
          teacher_feedback: data.feedback,
        })
        .eq('id', existingAnswer.id);

      if (error) return toDbFailure(error);
    } else {
      const { error } = await supabase.from('student_answers').insert({
        attempt_id: attempt.id,
        question_id: data.questionId,
        selected_option_id: null,
        is_correct: data.points > 0,
        teacher_points: data.points,
        teacher_feedback: data.feedback,
      });

      if (error) return toDbFailure(error);
    }

    const scoreResult = await this.computeAttemptScore(
      supabase,
      attempt.id,
      maxPoints.data,
      served.data,
    );
    if (isFailure(scoreResult)) return scoreResult;

    // Grading an open item puts it into the denominator: R16 keeps ungraded items out of
    // `earned`/`possible`, and a manual grade is what makes one gradable.
    const { error: gradeError } = await supabase
      .from('quiz_attempts')
      .update({
        score: scoreResult.data.score,
        total_points: scoreResult.data.possible,
        graded_at: new Date().toISOString(),
      })
      .eq('id', attempt.id);

    if (gradeError) return toDbFailure(gradeError);

    // Every saved answer re-stamps `graded_at`; the student is told once, at the first grade.
    if (firstGrade) {
      await this.notifier.assignmentGraded({ assignmentId: id, studentId: attempt.user_id });
    }

    return success(null);
  }

  /**
   * question_id → max awardable points and whether the item is auto-graded (a closed item), from
   * the assignment's published set. A missing key means the question is no longer part of it. The
   * pool is larger than one attempt's draw when `attempt_item_count` is set (R7), so this map is
   * intersected with the attempt's served items before it decides a score (#1298).
   *
   * The type comes from the snapshot, not the live row: R16 makes an open item ungraded until a
   * teacher grades it, and the published item is what the attempt is scored against (R11).
   */
  private async loadAssignmentPoints(
    supabase: SupabaseClient<Database>,
    assignmentId: string,
  ): Promise<ServiceResult<Map<string | null, { points: number; graded: boolean }>>> {
    const { data, error } = await supabase
      .from('assignment_questions')
      .select('question_id, points, snapshot')
      .eq('assignment_id', assignmentId);

    if (error) return toDbFailure(error);
    return success(
      new Map(
        dbRows(data).map((q) => [
          q.question_id,
          { points: q.points, graded: snapshotFromJson(q.snapshot)?.type !== 'open' },
        ]),
      ),
    );
  }

  /**
   * Awarded points and the denominator for an assignment attempt: manual teacher points win,
   * otherwise a correct auto-graded answer earns the question's points. Answers are keyed per
   * question because rows written before the one-row contract (#1065) could repeat one — a
   * question must never score twice.
   *
   * Both sides are restricted to the attempt's **served** items: the pool can be larger than the
   * draw (`attempt_item_count`, R7), and a manual grade must not widen the denominator to items
   * the student never saw (#1298). `possible` counts the served gradable items only (R16): every
   * closed served item, plus a served open item once a teacher has graded it. It is derived from
   * the published items rather than read back from `quiz_attempts.total_points`, which each manual
   * grade overwrites — reading that back would count an already-graded open item a second time.
   */
  private async computeAttemptScore(
    supabase: SupabaseClient<Database>,
    attemptId: string,
    pointsByQuestion: ReadonlyMap<string | null, { points: number; graded: boolean }>,
    served: ReadonlySet<string>,
  ): Promise<ServiceResult<{ score: number; possible: number }>> {
    const { data: answers, error: answersError } = await supabase
      .from('student_answers')
      .select('question_id, is_correct, teacher_points')
      .eq('attempt_id', attemptId);

    if (answersError) return toDbFailure(answersError);

    const perQuestion = new Map<
      string | null,
      { teacherPoints: number | null; isCorrect: boolean }
    >();
    for (const answer of dbRows(answers)) {
      const entry = perQuestion.get(answer.question_id) ?? {
        teacherPoints: null,
        isCorrect: false,
      };
      if (answer.teacher_points !== null) {
        entry.teacherPoints =
          entry.teacherPoints === null
            ? answer.teacher_points
            : Math.max(entry.teacherPoints, answer.teacher_points);
      }
      entry.isCorrect = entry.isCorrect || answer.is_correct;
      perQuestion.set(answer.question_id, entry);
    }

    let score = 0;
    for (const [questionId, entry] of perQuestion) {
      // An answer for an item this attempt was never served cannot earn points: the same served
      // set that bounds the denominator bounds the numerator (#1298).
      if (!questionId || !served.has(questionId)) continue;
      const questionMax = pointsByQuestion.get(questionId)?.points;
      if (entry.teacherPoints !== null) {
        // Legacy rows written before the upper bound existed (a 2-point
        // question graded 5) must not keep inflating the score (#169).
        score +=
          questionMax === undefined
            ? entry.teacherPoints
            : Math.min(entry.teacherPoints, questionMax);
      } else if (entry.isCorrect) {
        score += questionMax ?? 0;
      }
    }

    // The denominator is the attempt's served set, never the assignment's pool (#1298): a closed
    // served item always counts, and a served open item joins it once a teacher has graded it
    // (R16: ungraded items stay outside `earned`/`possible`). A served item no longer published on
    // the assignment has no points to award, so it is skipped.
    let possible = 0;
    for (const questionId of served) {
      const item = pointsByQuestion.get(questionId);
      if (!item) continue;
      const gradedOpen = perQuestion.get(questionId)?.teacherPoints != null;
      if (item.graded || gradedOpen) possible += item.points;
    }

    return success({ score, possible });
  }

  /**
   * Attempt state shared by the student list and detail payloads.
   * `attempts_used` counts *completed* attempts only — the same rule
   * `startAttempt` enforces. A running attempt is resumed, not counted.
   * `attempt` stays the newest attempt (running or completed) so „Kontynuuj”
   * keeps working; `last_completed_attempt` feeds the result card/review link
   * even while a retake is running.
   *
   * `score === null` means the result is withheld by `show_results` (#374).
   * Completion metadata (`id`, `completed_at`, `attempts_used`, totals) stays so
   * the pages can still render „Ukończono” without revealing the result.
   */
  private summarizeAttempts(rows: StudentAttemptSummaryRow[], showResults: boolean) {
    const ordered = [...rows].toSorted((a, b) => {
      const at = a.started_at ? new Date(a.started_at).getTime() : 0;
      const bt = b.started_at ? new Date(b.started_at).getTime() : 0;
      return at - bt || a.id.localeCompare(b.id);
    });
    const completed = ordered.filter((row) => row.completed_at !== null);
    const withScore = (row: StudentAttemptSummaryRow | undefined) =>
      row ? { ...row, score: showResults ? row.score : null } : null;
    return {
      attempt: withScore(ordered.at(-1)),
      last_completed_attempt: withScore(completed.at(-1)),
      // Consumed = submitted or expired at close; a running attempt is resumed, not counted.
      attempts_used: ordered.filter((row) => row.completed_at || row.expired_at).length,
    };
  }

  async listForStudent(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const [{ data: groups, error: groupError }, { data: orgRows, error: orgError }] =
      await Promise.all([
        supabase.from('group_members').select('group_id').eq('user_id', ctx.userId),
        supabase.from('org_members').select('organization_id').eq('user_id', ctx.userId),
      ]);

    if (groupError) return toDbFailure(groupError);
    if (orgError) return toDbFailure(orgError);
    const groupIds = dbRows(groups).map((g) => g.group_id);
    const orgIds = new Set(dbRows(orgRows).map((r) => r.organization_id));

    const { data: assignments, error } = await supabase
      .from('teacher_assignments')
      .select('*, assignment_targets(*)')
      .eq('status', 'published')
      .order('deadline', { ascending: true });

    if (error) return toDbFailure(error);

    const filtered = dbRows(assignments).filter((a) => {
      // Org content is only visible to current members of that org: a stale
      // group_members row must not surface it (#249). Personal assignments
      // (organization_id = null) keep the target-based rule.
      if (a.organization_id && !orgIds.has(a.organization_id)) return false;
      if (a.created_by === ctx.userId) return true;
      const targets = dbRows(a.assignment_targets);
      return targets.some(
        (t) => (t.group_id && groupIds.includes(t.group_id)) || t.student_id === ctx.userId,
      );
    });

    const attemptIds = filtered.map((a) => a.id);
    const { data: attempts, error: attemptsError } = await supabase
      .from('quiz_attempts')
      .select(STUDENT_ATTEMPT_SELECT)
      .in('assignment_id', attemptIds)
      .eq('user_id', ctx.userId);

    if (attemptsError) return toDbFailure(attemptsError);

    const attemptsByAssignment = new Map<string | null, StudentAttemptSummaryRow[]>();
    for (const row of dbRows(attempts)) {
      const rows = attemptsByAssignment.get(row.assignment_id) ?? [];
      rows.push(row);
      attemptsByAssignment.set(row.assignment_id, rows);
    }

    const result = filtered.map((a) => ({
      ...a,
      ...this.summarizeAttempts(attemptsByAssignment.get(a.id) ?? [], a.show_results),
    }));

    return success(result);
  }

  async getForStudent(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const loaded = await loadTargetedAssignment(supabase, id, ctx.userId);
    if (isFailure(loaded)) return loaded;
    const assignment = loaded.data;

    const { data: attempts, error: attemptsError } = await supabase
      .from('quiz_attempts')
      .select(STUDENT_ATTEMPT_SELECT)
      .eq('assignment_id', id)
      .eq('user_id', ctx.userId);

    if (attemptsError) return toDbFailure(attemptsError);

    return success({
      ...assignment,
      // Review is unlocked by the close, for the whole cohort (R5) — including a student who used
      // no attempt. `show_results` still decides whether a review exists at all.
      review_unlocked: isAssessmentClosed(assignment),
      ...this.summarizeAttempts(dbRows(attempts), assignment.show_results),
    });
  }

  async startAttempt(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const target = await loadTargetedAssignment(supabase, id, ctx.userId);
    if (isFailure(target)) return target;
    const assignment = target.data;

    // The window is the only place attempts exist (R7): after the close (`closed_at`, not the
    // clock) there is no way back in, and before it opens there is nothing to start.
    const now = new Date();
    if (isAssessmentClosed(assignment, now)) {
      return failure('ATTEMPTS_CLOSED');
    }
    if (assignment.start_time && now < new Date(assignment.start_time)) {
      return failure('ATTEMPTS_NOT_OPEN');
    }

    const { data: existingAttempts, error: attemptsError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('assignment_id', id)
      .eq('user_id', ctx.userId)
      .order('started_at', { ascending: false });

    // Never swallow this error: starting a new attempt because the lookup
    // failed is exactly the duplicate-attempt bug this endpoint had (#369).
    if (attemptsError) return toDbFailure(attemptsError);

    const attempts = dbRows(existingAttempts);
    // An attempt that expired at close is terminal: it is not resumable and it is consumed (R7).
    const openAttempt = attempts.find((a) => !a.completed_at && !a.expired_at);

    // „Kontynuuj" must reopen the same attempt, never mint a new one —
    // otherwise a student farms fresh attempts and dodges max_attempts (#369).
    if (openAttempt) {
      return this.loadAttemptForTake(supabase, openAttempt);
    }

    const completedCount = attempts.filter((a) => a.completed_at || a.expired_at).length;

    // The budget is a product state, not a throttle: the student (and the UI) must be able to tell
    // "you are out of attempts" from "slow down" (R19).
    if (completedCount >= assignment.max_attempts) {
      return failure('NO_ATTEMPTS_LEFT');
    }

    const links = await readAssignmentLinks(id);
    if (isFailure(links)) return links;
    if (links.data.length === 0) return failure('NOT_FOUND');

    const sample = await this.drawAttemptSample(id, ctx.userId, links.data, {
      isRetake: attempts.length > 0,
      allowSameItemRetake: assignment.allow_same_item_retake,
      itemCount: assignment.attempt_item_count ?? null,
      unseenOnly: assignment.unseen_only,
    });
    if (isFailure(sample)) return sample;

    const orderedQuestions = assignment.shuffle_questions
      ? [...sample.data].toSorted(() => Math.random() - 0.5)
      : [...sample.data];

    // Snapshot the assignment's scale on the attempt: an assignment is scored
    // in points, and the denominator must stay stable if the assignment's
    // questions change later (same reasoning as total_questions).
    //
    // Open items are ungraded (R16), so they are not part of the denominator: an assignment of
    // open items only has `total_points: 0`, which the review reports as no score rather than 0.
    const totalPoints = orderedQuestions.reduce((sum, link) => {
      const graded = snapshotFromJson(link.snapshot)?.type !== 'open';
      return graded ? sum + link.points : sum;
    }, 0);

    // The published item, never the live row (R11); a missing snapshot is a corrupt state.
    const payloads = orderedQuestions.flatMap((link) => {
      const snapshot = snapshotFromJson(link.snapshot);
      return snapshot ? [{ ...snapshot, snapshot_version: link.snapshot_version }] : [];
    });
    if (payloads.length !== orderedQuestions.length) return failure('INTERNAL_SERVER');

    if (assignment.shuffle_answers) {
      for (const question of payloads) {
        question.question_answers = question.question_answers.toSorted(() => Math.random() - 0.5);
      }
    }

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .insert({
        user_id: ctx.userId,
        assignment_id: id,
        score: 0,
        total_questions: orderedQuestions.length,
        total_points: totalPoints,
      })
      .select()
      .single();

    if (attemptError) {
      // Two concurrent „Rozpocznij” calls can both pass the resume check. The
      // partial unique index makes the loser fail with 23505; it must resume
      // the winner's attempt instead of surfacing a conflict (#369).
      if (attemptError.code === '23505') {
        const { data: raced } = await supabase
          .from('quiz_attempts')
          .select('*')
          .eq('assignment_id', id)
          .eq('user_id', ctx.userId)
          .is('completed_at', null)
          .maybeSingle();

        if (raced) return this.loadAttemptForTake(supabase, raced);
      }

      return toDbFailure(attemptError);
    }

    // Same nullable `question_id`: a link row without a question would be
    // rejected by the insert, so it is skipped and the original order kept.
    const attemptQuestions = orderedQuestions.flatMap((q, i) =>
      q.question_id ? [{ attempt_id: attempt.id, question_id: q.question_id, order_index: i }] : [],
    );

    const { error: linkError } = await supabase
      .from('quiz_attempt_questions')
      .insert(attemptQuestions);

    if (linkError) return toDbFailure(linkError);

    return success({
      ...toAttemptPayload(attempt),
      questions: payloads,
    });
  }

  /**
   * The items one attempt serves (R6/R7/R8/R9). The pool is everything the assessment binds; the
   * draw is `attempt_item_count` of it (all of it when the teacher set no count).
   *
   * The assessment's `unseen_only` decides whether prior exposure excludes an item:
   *
   * - off (the default) — a first attempt draws from the whole bound pool. Studying must not cost a
   *   student items, and a `409 NO_UNSEEN_ITEMS` on a first attempt was the complaint that made
   *   this the default (#1172 revisited). A retake is still a **fresh sample**: served and answered
   *   items stay out, which is what keeps R6/R7's disjointness.
   * - on — the phase-3 rule, exactly: served, answered and key-rendered items are all excluded, and
   *   `taughtItem` waives both (R9). An exhausted inventory is `409 NO_UNSEEN_ITEMS`, never a silent
   *   reuse of a burnt item.
   *
   * `allow_same_item_retake` serves the items the earlier attempt was served, which is what "same
   * item" means. A prior attempt with no served rows is a corrupt state, and serving the pool is the
   * honest repair rather than a refusal.
   *
   * Both retake forms happen inside the window: this method already refused everything outside it.
   */
  private async drawAttemptSample(
    id: string,
    studentId: string,
    links: AssignmentLink[],
    options: {
      isRetake: boolean;
      allowSameItemRetake: boolean;
      itemCount: number | null;
      unseenOnly: boolean;
    },
  ): Promise<ServiceResult<AssignmentLink[]>> {
    if (options.isRetake && options.allowSameItemRetake) {
      const history = await this.attemptHistoryFor(id, studentId, links);
      if (isFailure(history)) return history;
      const same = sampleServed(links, history.data.served);
      return success(drawSample(same.length > 0 ? same : links, options.itemCount));
    }

    // A first attempt of a default assessment serves the whole pool: nothing can be stale yet, so
    // the history read would only ever be spent to prove it is empty.
    if (!options.unseenOnly && !options.isRetake) {
      return success(drawSample(links, options.itemCount));
    }

    const history = await this.attemptHistoryFor(id, studentId, links);
    if (isFailure(history)) return history;

    const eligible = sampleEligible(
      links,
      { seen: history.data.seen, exposed: history.data.exposed },
      options.unseenOnly,
    );
    if (eligible.length === 0) return failure('NO_UNSEEN_ITEMS');
    return success(drawSample(eligible, options.itemCount));
  }

  private async attemptHistoryFor(
    id: string,
    studentId: string,
    links: AssignmentLink[],
  ): Promise<ReturnType<typeof attemptHistory>> {
    const candidates = [
      ...new Set(links.flatMap((link) => (link.question_id ? [link.question_id] : []))),
    ];
    return attemptHistory(studentId, id, candidates);
  }

  /**
   * Continue payload: the attempt's own question snapshot (the assignment may
   * have been edited since), never the answer key (#331), never the raw
   * `draft_answers` column (#349).
   *
   * Reading `quiz_attempt_questions` keeps the ordering/shuffling from the
   * original start, so „Kontynuuj” shows the questions the student already had.
   */
  private async loadAttemptForTake(
    supabase: SupabaseClient<Database>,
    attempt: QuizAttemptRow,
  ): Promise<ServiceResult<unknown>> {
    // The published snapshot for an assignment attempt, the live item for practice.
    const questions = await readAttemptQuestions(supabase, attempt);
    if (isFailure(questions)) return questions;

    return success({ ...toAttemptPayload(attempt), questions: questions.data });
  }

  /**
   * Rows for the answers CSV — the same summary the results view renders
   * (one row per attempt: student, e-mail, score, status, completion date).
   * Ownership already proves the assignment exists, so the questions/answer
   * key payload is not read here.
   */
  async exportAnswers(
    id: string,
    studentId: string | undefined,
    ctx: RequestContext,
  ): Promise<ServiceResult<AnswersExportRow[]>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    let query = supabase
      .from('quiz_attempts')
      .select(
        'id, score, total_questions, total_points, completed_at, graded_at, user:user_id(id, email, full_name)',
      )
      .eq('assignment_id', id)
      .order('started_at', { ascending: false });

    if (studentId) {
      query = query.eq('user_id', studentId);
    }

    const { data: attempts, error: attemptsError } = await query;

    if (attemptsError) return toDbFailure(attemptsError);

    const rows = dbRows(attempts).map((attempt) => {
      const user = joinOne(attempt.user);
      return {
        studentName: user?.full_name ?? null,
        email: user?.email ?? null,
        score: attempt.completed_at
          ? // `0` is a real denominator here (open items are ungraded, R16): only a missing
            // value falls back to the question count.
            `${attempt.score}/${attempt.total_points ?? attempt.total_questions}`
          : '-',
        status: attempt.graded_at
          ? ('graded' as const)
          : attempt.completed_at
            ? ('submitted' as const)
            : ('in_progress' as const),
        completedAt: attempt.completed_at,
      };
    });

    return success(rows);
  }

  async uploadImage(
    id: string,
    attemptId: string,
    questionId: string,
    imageUrl: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .select('id, user_id')
      .eq('id', attemptId)
      .eq('assignment_id', id)
      .single();

    if (!attempt) return failure('NOT_FOUND');
    if (attempt.user_id !== ctx.userId) return failure('FORBIDDEN');

    const { error } = await supabase.from('assignment_answer_images').insert({
      attempt_id: attemptId,
      question_id: questionId,
      image_url: imageUrl,
    });

    if (error) return toDbFailure(error);
    return success({ imageUrl });
  }

  /**
   * True when a group or student of `data` is not part of the assignment's organisation.
   *
   * A personal assignment (`organization_id` NULL, a legacy row: new ones are created inside an
   * organisation) has no tenant of its own: direct student targets keep working, while a group
   * is organisation-owned and must belong to one of the caller's organisations (its members
   * would otherwise gain access to another tenant's assignment). Counts are requested with
   * `head: true` so a long target list is not truncated by the PostgREST row limit, and the ids
   * are sent in chunks so a large class does not overflow the request URL.
   */
  private async hasForeignTargets(
    supabase: SupabaseClient<Database>,
    assignmentId: string,
    data: SetTargetsInput,
    ctx: RequestContext,
  ): Promise<boolean> {
    const groupIds = [...new Set(data.groupIds ?? [])];
    const studentIds = [...new Set(data.studentIds ?? [])];
    if (groupIds.length === 0 && studentIds.length === 0) return false;

    const { data: assignment, error: assignmentError } = await supabase
      .from('teacher_assignments')
      .select('organization_id')
      .eq('id', assignmentId)
      .maybeSingle();
    // Fail closed: a failed read must not be mistaken for a personal (no-organisation) row.
    if (assignmentError || !assignment) return true;
    const organizationId = assignment.organization_id;

    if (organizationId === null) {
      if (groupIds.length === 0) return false;

      const { data: memberships } = await supabase
        .from('org_members')
        .select('organization_id')
        .eq('user_id', ctx.userId);
      const callerOrgIds = [
        ...new Set(
          (memberships ?? []).flatMap((m) => (m.organization_id ? [m.organization_id] : [])),
        ),
      ];
      if (callerOrgIds.length === 0) return true;

      let found = 0;
      for (let i = 0; i < groupIds.length; i += TARGET_CHUNK) {
        const { count, error } = await supabase
          .from('groups')
          .select('id', { count: 'exact', head: true })
          .in('id', groupIds.slice(i, i + TARGET_CHUNK))
          .in('organization_id', callerOrgIds);
        if (error) return true;
        found += count ?? 0;
      }
      return found !== groupIds.length;
    }

    if (groupIds.length > 0) {
      let found = 0;
      for (let i = 0; i < groupIds.length; i += TARGET_CHUNK) {
        const { count, error } = await supabase
          .from('groups')
          .select('id', { count: 'exact', head: true })
          .in('id', groupIds.slice(i, i + TARGET_CHUNK))
          .eq('organization_id', organizationId);
        if (error) return true;
        found += count ?? 0;
      }
      if (found !== groupIds.length) return true;
    }
    if (studentIds.length > 0) {
      let found = 0;
      for (let i = 0; i < studentIds.length; i += TARGET_CHUNK) {
        const { count, error } = await supabase
          .from('org_members')
          .select('user_id', { count: 'exact', head: true })
          .in('user_id', studentIds.slice(i, i + TARGET_CHUNK))
          .eq('organization_id', organizationId);
        if (error) return true;
        found += count ?? 0;
      }
      if (found !== studentIds.length) return true;
    }
    return false;
  }

  /** Ids already attached, so re-adding a question is a no-op instead of a duplicate row. */
  private async existingQuestionIds(
    supabase: SupabaseClient<Database>,
    assignmentId: string,
  ): Promise<ServiceResult<Set<string | null>>> {
    const { data, error } = await supabase
      .from('assignment_questions')
      .select('question_id')
      .eq('assignment_id', assignmentId);

    if (error) return toDbFailure(error);
    return success(new Set(dbRows(data).map((q) => q.question_id)));
  }

  /**
   * The client for an assignment the caller may edit, refusing a live one. A published
   * assessment's item set is frozen (R13): adding an item would leave the next start without a
   * snapshot and removing one would shorten an in-progress attempt. `409 ASSESSMENT_LIVE` until
   * slice 2 formalises the composer rules.
   */
  private async draftClient(
    id: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<SupabaseClient<Database>>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    const { data, error } = await supabase
      .from('teacher_assignments')
      .select('status')
      .eq('id', id)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return failure('NOT_FOUND');
    if (data.status !== 'draft') return failure('ASSESSMENT_LIVE');
    return success(supabase);
  }

  /** The client for an assignment the caller may write; `null` when it is missing or foreign. */
  private async ownedClient(
    id: string,
    ctx: RequestContext,
  ): Promise<SupabaseClient<Database> | null> {
    const supabase = await this.clientFactory();
    if (!(await this.verifyOwnership(id, ctx))) return null;
    return supabase;
  }

  /**
   * The client and the window fields for an assessment the caller may write. Ownership is proved
   * first (a foreign or missing id is `NOT_FOUND`), then the row the action decides on is read.
   */
  private async loadOwnedCloseWindow(
    id: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<OwnedWindow>> {
    const supabase = await this.ownedClient(id, ctx);
    if (!supabase) return failure('NOT_FOUND');

    const loaded = await this.loadCloseWindow(supabase, id);
    if (isFailure(loaded)) return loaded;
    return success({ supabase, run: loaded.data });
  }

  /**
   * The prelude every lifecycle action shares (R12/R19/R20): ownership, then a published run that
   * still has a window to act on. A cancelled run is terminal, a draft was never published, and a
   * closed run already released its items and expired its attempts — none of the three has anything
   * left to move, and reviving one would serve an assessment whose first attempt already happened.
   *
   * The natural expiry is settled here, so the refusal is decided on the durable close: a run whose
   * deadline has passed is closed even if no reader had written `closed_at` yet, and this is the read
   * that writes it down.
   */
  private async loadOpenWindow(
    id: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<OwnedWindow>> {
    const loaded = await this.loadOwnedCloseWindow(id, ctx);
    if (isFailure(loaded)) return loaded;

    if (loaded.data.run.status === 'cancelled') return failure('ASSESSMENT_CANCELLED');
    if (loaded.data.run.status !== 'published') return failure('ASSESSMENT_NOT_PUBLISHED');

    const settled = await ensureClosed(loaded.data.run);
    if (isFailure(settled)) return settled;
    if (isAssessmentClosed(settled.data)) return failure('ASSESSMENT_CLOSED');

    return success({ supabase: loaded.data.supabase, run: settled.data });
  }

  /**
   * The once-only close: fills `closed_at` under the race guard (two closes serialise on the empty
   * column, and a natural expiry may have got there first) and then expires the attempts that were
   * still running. The expiry needs the service role — a teacher may not write another user's
   * attempt rows — so it lives here rather than in the caller.
   */
  private async stampClose(
    supabase: SupabaseClient<Database>,
    id: string,
    now: Date,
    extra: Database['public']['Tables']['teacher_assignments']['Update'],
  ): Promise<
    ServiceResult<
      Database['public']['Tables']['teacher_assignments']['Row'] & { expired_attempts: number }
    >
  > {
    const closedAt = now.toISOString();
    const updated = await this.writeWindow(supabase, id, {
      ...extra,
      closed_at: closedAt,
      updated_at: closedAt,
    });
    if (isFailure(updated)) return updated;

    const expired = await expireInProgressAttempts(id, updated.data.closed_at ?? closedAt);
    if (isFailure(expired)) return expired;
    return success({ ...updated.data, expired_attempts: expired.data });
  }

  /**
   * Writes window fields on a run that is still open, refusing to land on a run that closed between
   * the read and the write: a moved bound must never touch a revealed run.
   */
  private async writeWindow(
    supabase: SupabaseClient<Database>,
    id: string,
    patch: Database['public']['Tables']['teacher_assignments']['Update'],
  ): Promise<ServiceResult<Database['public']['Tables']['teacher_assignments']['Row']>> {
    const { data: updated, error } = await supabase
      .from('teacher_assignments')
      .update(patch)
      .eq('id', id)
      .eq('status', 'published')
      .is('closed_at', null)
      .select()
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!updated) return failure('ASSESSMENT_CLOSED');
    return success(updated);
  }

  /**
   * The window fields the close decides on. Ownership already proved the caller may write, so a
   * missing row here is only a stale id.
   */
  private async loadCloseWindow(
    supabase: SupabaseClient<Database>,
    id: string,
  ): Promise<
    ServiceResult<{
      id: string;
      status: string;
      start_time: string | null;
      deadline: string | null;
      closed_at: string | null;
    }>
  > {
    const { data, error } = await supabase
      .from('teacher_assignments')
      .select('id, status, start_time, deadline, closed_at')
      .eq('id', id)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return failure('NOT_FOUND');
    return success(data);
  }

  private async verifyOwnership(id: string, ctx: RequestContext): Promise<boolean> {
    const supabase = await this.clientFactory();

    const { data: assignment } = await supabase
      .from('teacher_assignments')
      .select('id, created_by, organization_id')
      .eq('id', id)
      .single();

    if (!assignment) return false;

    if (assignment.created_by === ctx.userId) return true;

    const scope = ctx.permissionScopes['assignment.update'];
    if (scope === 'organization' && assignment.organization_id === ctx.activeOrgId) return true;

    return false;
  }
}
export const teacherAssignmentService = wrapService(
  new TeacherAssignmentService(createClient, notificationService),
  'teacher-assignment.service',
);
