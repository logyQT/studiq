import type { RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { IN_PROGRESS_QUESTION_SELECT } from '@studiq/server/lib/question-view';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  AddQuestionsInput,
  CreateTeacherAssignmentInput,
  GradeAnswerInput,
  RandomizeInput,
  ReorderQuestionsInput,
  SetTargetsInput,
  UpdateTeacherAssignmentInput,
} from '@studiq/server/models/teacher-assignment.model';
import type { SupabaseClient } from '@supabase/supabase-js';
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
function toAttemptPayload(attempt: Record<string, unknown>): Record<string, unknown> {
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
  'assignment_id, id, score, total_questions, total_points, completed_at, started_at';

interface StudentAttemptSummaryRow {
  assignment_id: string;
  id: string;
  score: number;
  total_questions: number;
  total_points: number | null;
  completed_at: string | null;
  started_at: string | null;
}

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

export class TeacherAssignmentService {
  constructor(
    private createClient: () => Promise<SupabaseClient>,
    /** Tells students about a published assignment and a first grade; none in unit tests. */
    private notifier: Notifier = noopNotifier,
  ) {}

  async create(
    data: CreateTeacherAssignmentInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const insertData: Record<string, unknown> = {
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

    // Copy questions from quiz if quizId provided
    if (data.quizId) {
      const { data: quizQuestions } = await supabase
        .from('quiz_questions')
        .select('question_id, order_index, points')
        .eq('quiz_id', data.quizId)
        .order('order_index', { ascending: true });

      if (quizQuestions && quizQuestions.length > 0) {
        const assignmentQuestions = quizQuestions.map((q) => ({
          assignment_id: assignment.id,
          question_id: q.question_id,
          order_index: q.order_index,
          points: q.points,
        }));
        await supabase.from('assignment_questions').insert(assignmentQuestions);
      }
    }

    // Re-fetch with questions
    const { data: full, error: refetchError } = await supabase
      .from('teacher_assignments')
      .select('*, assignment_questions(*)')
      .eq('id', assignment.id)
      .single();

    if (refetchError) return toDbFailure(refetchError);
    return success(full);
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: assignment, error } = await supabase
      .from('teacher_assignments')
      .select(
        '*, assignment_questions(*, question:question_id(*, question_answers:question_options(*)))',
      )
      .eq('id', id)
      .single();

    if (error) return toDbFailure(error);
    if (!assignment) return failure('NOT_FOUND');

    if (assignment.created_by !== ctx.userId) {
      const scope = ctx.permissionScopes['assignment.read'];
      if (scope !== 'organization') return failure('FORBIDDEN');
      if (assignment.organization_id !== ctx.activeOrgId) return failure('FORBIDDEN');
    }

    return success(assignment);
  }

  async list(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

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
    return success(data ?? []);
  }

  async update(
    id: string,
    data: UpdateTeacherAssignmentInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.deadline !== undefined) updateData.deadline = data.deadline;
    if (data.timeLimitMin !== undefined) updateData.time_limit_min = data.timeLimitMin;
    if (data.shuffleQuestions !== undefined) updateData.shuffle_questions = data.shuffleQuestions;
    if (data.shuffleAnswers !== undefined) updateData.shuffle_answers = data.shuffleAnswers;
    if (data.showResults !== undefined) updateData.show_results = data.showResults;
    if (data.maxAttempts !== undefined) updateData.max_attempts = data.maxAttempts;
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
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

    const { error } = await supabase.from('teacher_assignments').delete().eq('id', id);
    if (error) return toDbFailure(error);
    return success(null);
  }

  async unpublish(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

    const { data: assignment, error: fetchError } = await supabase
      .from('teacher_assignments')
      .select('status')
      .eq('id', id)
      .single();

    if (fetchError) return toDbFailure(fetchError);
    if (!assignment) return failure('NOT_FOUND');
    if (assignment.status !== 'published') return failure('BAD_REQUEST');

    const { data: updated, error } = await supabase
      .from('teacher_assignments')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return toDbFailure(error);
    return success(updated);
  }

  async publish(
    id: string,
    deadline: string | undefined,
    startTime: string | undefined,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

    const { count } = await supabase
      .from('assignment_targets')
      .select('*', { count: 'exact', head: true })
      .eq('assignment_id', id);

    if (count === 0) return failure('BAD_REQUEST');

    // Only a save that leaves the assignment already published is silent; publishing a draft
    // (including one that was unpublished before) tells the students. A failed read must not
    // turn into a notification, so it skips the fan-out instead of guessing.
    const { data: before, error: beforeError } = await supabase
      .from('teacher_assignments')
      .select('status')
      .eq('id', id)
      .single();

    const updateData: Record<string, unknown> = {
      status: 'published',
      updated_at: new Date().toISOString(),
    };
    if (deadline !== undefined) updateData.deadline = deadline;
    if (startTime !== undefined) updateData.start_time = startTime;

    const { data: updated, error } = await supabase
      .from('teacher_assignments')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) return toDbFailure(error);

    if (!beforeError && before?.status !== 'published') {
      await this.notifier.assignmentPublished({ assignmentId: id, teacherId: ctx.userId });
    }
    return success(updated);
  }

  async addQuestions(
    id: string,
    data: AddQuestionsInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

    const existing = await supabase
      .from('assignment_questions')
      .select('question_id')
      .eq('assignment_id', id);

    if (existing.error) return toDbFailure(existing.error);

    const existingIds = new Set(existing.data?.map((q) => q.question_id) ?? []);
    const newIds = data.questionIds.filter((qid) => !existingIds.has(qid));

    if (newIds.length === 0) return success({ added: 0 });

    const { data: maxOrder } = await supabase
      .from('assignment_questions')
      .select('order_index')
      .eq('assignment_id', id)
      .order('order_index', { ascending: false })
      .limit(1);

    const nextOrder = (maxOrder?.[0]?.order_index ?? -1) + 1;

    const rows = newIds.map((questionId, i) => ({
      assignment_id: id,
      question_id: questionId,
      order_index: nextOrder + i,
    }));

    const { error } = await supabase.from('assignment_questions').insert(rows);
    if (error) return toDbFailure(error);

    return success({ added: newIds.length });
  }

  async removeQuestion(
    id: string,
    questionId: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

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
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

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
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

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

    const existing = await supabase
      .from('assignment_questions')
      .select('question_id')
      .eq('assignment_id', id);

    if (existing.error) return toDbFailure(existing.error);
    const existingIds = new Set(existing.data?.map((q) => q.question_id) ?? []);

    const { data: allQuestions, error: fetchError } = await query;
    if (fetchError) return toDbFailure(fetchError);

    const available = (allQuestions ?? []).filter((q) => !existingIds.has(q.id));
    if (available.length === 0) return success({ added: 0 });

    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(data.count, shuffled.length));

    const { data: maxOrder } = await supabase
      .from('assignment_questions')
      .select('order_index')
      .eq('assignment_id', id)
      .order('order_index', { ascending: false })
      .limit(1);

    const nextOrder = (maxOrder?.[0]?.order_index ?? -1) + 1;

    const rows = selected.map((q, i) => ({
      assignment_id: id,
      question_id: q.id,
      order_index: nextOrder + i,
    }));

    const { error: insertError } = await supabase.from('assignment_questions').insert(rows);

    if (insertError) return toDbFailure(insertError);
    return success({ added: selected.length });
  }

  async setTargets(
    id: string,
    data: SetTargetsInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

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

  async getResults(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

    const { data: attempts, error } = await supabase
      .from('quiz_attempts')
      .select('*, user:user_id(id, email, full_name)')
      .eq('assignment_id', id)
      .order('started_at', { ascending: false });

    if (error) return toDbFailure(error);
    return success(attempts ?? []);
  }

  async getStudentAnswers(
    id: string,
    studentId: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

    const { data: attempt, error } = await supabase
      .from('quiz_attempts')
      .select(
        '*, quiz_attempt_questions(*, question:question_id(*, question_answers:question_options(*))), quiz_answers:student_answers(*), assignment_answer_images(*)',
      )
      .eq('assignment_id', id)
      .eq('user_id', studentId)
      .single();

    if (error) return toDbFailure(error);
    if (!attempt) return failure('NOT_FOUND');

    const maxPoints = await this.loadAssignmentPoints(supabase, id);
    if (isFailure(maxPoints)) return maxPoints;

    return success({
      ...attempt,
      quiz_attempt_questions: (attempt.quiz_attempt_questions ?? []).map(
        (q: { question_id: string }) => ({
          ...q,
          max_points: maxPoints.data.get(q.question_id) ?? null,
        }),
      ),
    });
  }

  async gradeAnswer(
    id: string,
    studentId: string,
    data: GradeAnswerInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .select('id, graded_at')
      .eq('assignment_id', id)
      .eq('user_id', studentId)
      .single();

    if (!attempt) return failure('NOT_FOUND');
    const firstGrade = !attempt.graded_at;

    // The bound is per question (`assignment_questions.points`), so it cannot
    // live in the Zod schema. Reject before writing: points above the maximum
    // used to be persisted and inflated the attempt score (#169).
    const maxPoints = await this.loadAssignmentPoints(supabase, id);
    if (isFailure(maxPoints)) return maxPoints;

    const questionMax = maxPoints.data.get(data.questionId);
    // Also closes the forged-question-id hole: an answer for a question that is
    // not part of this assignment can no longer inflate `quiz_attempts.score`.
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

    const scoreResult = await this.computeAttemptScore(supabase, attempt.id, id);
    if (isFailure(scoreResult)) return scoreResult;

    const { error: gradeError } = await supabase
      .from('quiz_attempts')
      .update({
        score: scoreResult.data,
        graded_at: new Date().toISOString(),
      })
      .eq('id', attempt.id);

    if (gradeError) return toDbFailure(gradeError);

    // Every saved answer re-stamps `graded_at`; the student is told once, at the first grade.
    if (firstGrade) await this.notifier.assignmentGraded({ assignmentId: id, studentId });

    return success(null);
  }

  /**
   * question_id → max awardable points, from the assignment's current question
   * set. A missing key means the question is no longer part of the assignment.
   */
  private async loadAssignmentPoints(
    supabase: SupabaseClient,
    assignmentId: string,
  ): Promise<ServiceResult<Map<string, number>>> {
    const { data, error } = await supabase
      .from('assignment_questions')
      .select('question_id, points')
      .eq('assignment_id', assignmentId);

    if (error) return toDbFailure(error);
    return success(new Map((data ?? []).map((q) => [q.question_id, q.points ?? 0])));
  }

  /**
   * Awarded points for an assignment attempt: manual teacher points win,
   * otherwise a correct auto-graded answer earns the question's points.
   * Answers are deduplicated per question because multi-select / matching
   * questions store one row per selected unit.
   */
  private async computeAttemptScore(
    supabase: SupabaseClient,
    attemptId: string,
    assignmentId: string,
  ): Promise<ServiceResult<number>> {
    const pointsByQuestion = await this.loadAssignmentPoints(supabase, assignmentId);
    if (isFailure(pointsByQuestion)) return pointsByQuestion;

    const { data: answers, error: answersError } = await supabase
      .from('student_answers')
      .select('question_id, is_correct, teacher_points')
      .eq('attempt_id', attemptId);

    if (answersError) return toDbFailure(answersError);

    const perQuestion = new Map<string, { teacherPoints: number | null; isCorrect: boolean }>();
    for (const answer of answers ?? []) {
      const entry = perQuestion.get(answer.question_id) ?? {
        teacherPoints: null,
        isCorrect: false,
      };
      if (answer.teacher_points !== null && answer.teacher_points !== undefined) {
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
      const questionMax = pointsByQuestion.data.get(questionId);
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

    return success(score);
  }

  /**
   * A student may see / start an assignment only if it targets them directly,
   * targets one of their groups, or they authored it (teacher preview).
   * Same rule as the list endpoint, so id-based access cannot bypass it.
   */
  private async isAssignmentTarget(
    supabase: SupabaseClient,
    assignment: {
      created_by?: string | null;
      organization_id?: string | null;
      assignment_targets?: { group_id?: string | null; student_id?: string | null }[] | null;
    },
    userId: string,
  ): Promise<ServiceResult<boolean>> {
    // Org content requires current org membership; group_members is not an
    // authorization source on its own (#249). Without this a stale
    // group_members row keeps granting access after the user was removed from
    // the organization (the author included: "after removal you lose access to
    // all organization data").
    if (assignment.organization_id) {
      const { data: membership, error } = await supabase
        .from('org_members')
        .select('id')
        .eq('organization_id', assignment.organization_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) return toDbFailure(error);
      if (!membership) return success(false);
    }

    if (assignment.created_by === userId) return success(true);

    const targets = assignment.assignment_targets ?? [];
    if (targets.some((t) => t.student_id === userId)) return success(true);

    const targetGroupIds = targets.map((t) => t.group_id).filter((g): g is string => !!g);
    if (targetGroupIds.length === 0) return success(false);

    const { data: memberships, error } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId)
      .in('group_id', targetGroupIds);

    if (error) return toDbFailure(error);
    return success((memberships ?? []).length > 0);
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
    const ordered = [...rows].sort((a, b) => {
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
      attempts_used: completed.length,
    };
  }

  async listForStudent(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const [{ data: groups, error: groupError }, { data: orgRows, error: orgError }] =
      await Promise.all([
        supabase.from('group_members').select('group_id').eq('user_id', ctx.userId),
        supabase.from('org_members').select('organization_id').eq('user_id', ctx.userId),
      ]);

    if (groupError) return toDbFailure(groupError);
    if (orgError) return toDbFailure(orgError);
    const groupIds = groups?.map((g) => g.group_id) ?? [];
    const orgIds = new Set((orgRows ?? []).map((r) => r.organization_id));

    const { data: assignments, error } = await supabase
      .from('teacher_assignments')
      .select('*, assignment_targets(*)')
      .eq('status', 'published')
      .order('deadline', { ascending: true });

    if (error) return toDbFailure(error);

    const filtered = (assignments ?? []).filter((a) => {
      // Org content is only visible to current members of that org: a stale
      // group_members row must not surface it (#249). Personal assignments
      // (organization_id = null) keep the target-based rule.
      if (a.organization_id && !orgIds.has(a.organization_id)) return false;
      if (a.created_by === ctx.userId) return true;
      const targets = a.assignment_targets ?? [];
      return targets.some(
        (t: { group_id?: string; student_id?: string }) =>
          (t.group_id && groupIds.includes(t.group_id)) || t.student_id === ctx.userId,
      );
    });

    const attemptIds = filtered.map((a) => a.id);
    const { data: attempts, error: attemptsError } = await supabase
      .from('quiz_attempts')
      .select(STUDENT_ATTEMPT_SELECT)
      .in('assignment_id', attemptIds)
      .eq('user_id', ctx.userId);

    if (attemptsError) return toDbFailure(attemptsError);

    const attemptsByAssignment = new Map<string, StudentAttemptSummaryRow[]>();
    for (const row of (attempts ?? []) as StudentAttemptSummaryRow[]) {
      const rows = attemptsByAssignment.get(row.assignment_id) ?? [];
      rows.push(row);
      attemptsByAssignment.set(row.assignment_id, rows);
    }

    const result = filtered.map((a) => ({
      ...a,
      ...this.summarizeAttempts(attemptsByAssignment.get(a.id) ?? [], a.show_results === true),
    }));

    return success(result);
  }

  async getForStudent(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: assignment, error } = await supabase
      .from('teacher_assignments')
      .select('*, assignment_targets(*)')
      .eq('id', id)
      .eq('status', 'published')
      .single();

    if (error) return toDbFailure(error);
    if (!assignment) return failure('NOT_FOUND');

    const targeted = await this.isAssignmentTarget(supabase, assignment, ctx.userId);
    if (isFailure(targeted)) return targeted;
    if (!targeted.data) return failure('NOT_FOUND');

    const { data: attempts, error: attemptsError } = await supabase
      .from('quiz_attempts')
      .select(STUDENT_ATTEMPT_SELECT)
      .eq('assignment_id', id)
      .eq('user_id', ctx.userId);

    if (attemptsError) return toDbFailure(attemptsError);

    return success({
      ...assignment,
      ...this.summarizeAttempts(
        (attempts ?? []) as StudentAttemptSummaryRow[],
        assignment.show_results === true,
      ),
    });
  }

  async startAttempt(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: assignment, error: assignmentError } = await supabase
      .from('teacher_assignments')
      .select('*, assignment_questions(*), assignment_targets(*)')
      .eq('id', id)
      .eq('status', 'published')
      .single();

    if (assignmentError) return toDbFailure(assignmentError);
    if (!assignment) return failure('NOT_FOUND');

    const targeted = await this.isAssignmentTarget(supabase, assignment, ctx.userId);
    if (isFailure(targeted)) return targeted;
    if (!targeted.data) return failure('NOT_FOUND');

    // Check time window
    const now = new Date();
    if (assignment.start_time && now < new Date(assignment.start_time)) {
      return failure('BAD_REQUEST');
    }
    if (assignment.deadline) {
      const graceEnd = new Date(assignment.deadline);
      graceEnd.setSeconds(graceEnd.getSeconds() + 60);
      if (now > graceEnd) {
        return failure('GONE');
      }
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

    const attempts = existingAttempts ?? [];
    const openAttempt = attempts.find((a) => !a.completed_at);

    // „Kontynuuj" must reopen the same attempt, never mint a new one —
    // otherwise a student farms fresh attempts and dodges max_attempts (#369).
    if (openAttempt) {
      return this.loadAttemptForTake(supabase, openAttempt);
    }

    const completedCount = attempts.filter((a) => a.completed_at).length;

    if (completedCount >= assignment.max_attempts) {
      return failure('RATE_LIMITED');
    }

    const questions = assignment.assignment_questions ?? [];
    if (questions.length === 0) return failure('NOT_FOUND');

    let orderedQuestions = [...questions];
    if (assignment.shuffle_questions) {
      orderedQuestions = orderedQuestions.sort(() => Math.random() - 0.5);
    }

    // Snapshot the assignment's scale on the attempt: an assignment is scored
    // in points, and the denominator must stay stable if the assignment's
    // questions change later (same reasoning as total_questions).
    const totalPoints = orderedQuestions.reduce((sum, q) => sum + (q.points ?? 1), 0);

    const { data: fullQuestions, error: questionsError } = await supabase
      .from('questions')
      .select(IN_PROGRESS_QUESTION_SELECT)
      .in(
        'id',
        orderedQuestions.map((q) => q.question_id),
      );

    if (questionsError) return toDbFailure(questionsError);

    if (assignment.shuffle_answers) {
      for (const q of fullQuestions ?? []) {
        if (q.question_answers) {
          q.question_answers = q.question_answers.sort(() => Math.random() - 0.5);
        }
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

    const attemptQuestions = orderedQuestions.map((q, i) => ({
      attempt_id: attempt.id,
      question_id: q.question_id,
      order_index: i,
    }));

    const { error: linkError } = await supabase
      .from('quiz_attempt_questions')
      .insert(attemptQuestions);

    if (linkError) return toDbFailure(linkError);

    return success({
      ...toAttemptPayload(attempt),
      questions: fullQuestions ?? [],
    });
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
    supabase: SupabaseClient,
    attempt: Record<string, unknown>,
  ): Promise<ServiceResult<unknown>> {
    const { data: rows, error } = await supabase
      .from('quiz_attempt_questions')
      .select(`order_index, question_id, questions(${IN_PROGRESS_QUESTION_SELECT})`)
      .eq('attempt_id', attempt.id as string)
      .order('order_index', { ascending: true });

    if (error) return toDbFailure(error);

    const questions = (rows ?? []).map((row) => row.questions).filter(Boolean);

    return success({ ...toAttemptPayload(attempt), questions });
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
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

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

    const rows = (attempts ?? []).map((attempt) => {
      const user = joinOne(attempt.user);
      return {
        studentName: user?.full_name ?? null,
        email: user?.email ?? null,
        score: attempt.completed_at
          ? `${attempt.score ?? 0}/${attempt.total_points || attempt.total_questions || 0}`
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
    const supabase = await this.createClient();

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
    supabase: SupabaseClient,
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
      .single();
    // Fail closed: a failed read must not be mistaken for a personal (no-organisation) row.
    if (assignmentError || !assignment) return true;
    const organizationId = assignment.organization_id as string | null;

    if (organizationId === null) {
      if (groupIds.length === 0) return false;

      const { data: memberships } = await supabase
        .from('org_members')
        .select('organization_id')
        .eq('user_id', ctx.userId);
      const callerOrgIds = [
        ...new Set((memberships ?? []).map((m) => m.organization_id as string)),
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

  private async verifyOwnership(id: string, ctx: RequestContext): Promise<boolean> {
    const supabase = await this.createClient();

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
