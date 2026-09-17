import type { RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
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

export class TeacherAssignmentService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

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

    let query = supabase
      .from('questions')
      .select('id')
      .or(`organization_id.eq.${ctx.activeOrgId},created_by.eq.${ctx.userId}`);

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

    return success(attempt);
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
      .select('id')
      .eq('assignment_id', id)
      .eq('user_id', studentId)
      .single();

    if (!attempt) return failure('NOT_FOUND');

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

    await supabase
      .from('quiz_attempts')
      .update({ graded_at: new Date().toISOString() })
      .eq('id', attempt.id);

    return success(null);
  }

  async listForStudent(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: groups, error: groupError } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', ctx.userId);

    if (groupError) return toDbFailure(groupError);
    const groupIds = groups?.map((g) => g.group_id) ?? [];

    const { data: assignments, error } = await supabase
      .from('teacher_assignments')
      .select('*, assignment_targets(*)')
      .eq('status', 'published')
      .order('deadline', { ascending: true });

    if (error) return toDbFailure(error);

    const filtered = (assignments ?? []).filter((a) => {
      if (a.created_by === ctx.userId) return true;
      const targets = a.assignment_targets ?? [];
      return targets.some(
        (t: { group_id?: string; student_id?: string }) =>
          (t.group_id && groupIds.includes(t.group_id)) || t.student_id === ctx.userId,
      );
    });

    const attemptIds = filtered.map((a) => a.id);
    const { data: attempts } = await supabase
      .from('quiz_attempts')
      .select('assignment_id, id, score, total_questions, completed_at, started_at')
      .in('assignment_id', attemptIds)
      .eq('user_id', ctx.userId);

    const attemptMap = new Map((attempts ?? []).map((a) => [a.assignment_id, a]));

    const result = filtered.map((a) => ({
      ...a,
      attempt: attemptMap.get(a.id) ?? null,
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

    const { data: attempt } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('assignment_id', id)
      .eq('user_id', ctx.userId)
      .single();

    return success({
      ...assignment,
      attempt: attempt ?? null,
    });
  }

  async startAttempt(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: assignment, error: assignmentError } = await supabase
      .from('teacher_assignments')
      .select('*, assignment_questions(*)')
      .eq('id', id)
      .eq('status', 'published')
      .single();

    if (assignmentError) return toDbFailure(assignmentError);
    if (!assignment) return failure('NOT_FOUND');

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

    const { data: existingAttempt } = await supabase
      .from('quiz_attempts')
      .select('id, completed_at')
      .eq('assignment_id', id)
      .eq('user_id', ctx.userId);

    const attempts = existingAttempt ?? [];
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

    const { data: fullQuestions, error: questionsError } = await supabase
      .from('questions')
      .select('*, question_answers:question_options(*)')
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
      })
      .select()
      .single();

    if (attemptError) return toDbFailure(attemptError);

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
      ...attempt,
      questions: fullQuestions ?? [],
    });
  }

  async exportAnswers(
    id: string,
    studentId: string | undefined,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const check = await this.verifyOwnership(id, ctx);
    if (!check) return failure('NOT_FOUND');

    const { data: assignment, error: assignmentError } = await supabase
      .from('teacher_assignments')
      .select(
        '*, assignment_questions(*, question:question_id(*, question_answers:question_options(*)))',
      )
      .eq('id', id)
      .single();

    if (assignmentError) return toDbFailure(assignmentError);
    if (!assignment) return failure('NOT_FOUND');

    let query = supabase
      .from('quiz_attempts')
      .select(
        '*, user:user_id(id, email, full_name), quiz_answers:student_answers(*), assignment_answer_images(*)',
      )
      .eq('assignment_id', id)
      .order('started_at', { ascending: true });

    if (studentId) {
      query = query.eq('user_id', studentId);
    }

    const { data: attempts, error: attemptsError } = await query;

    if (attemptsError) return toDbFailure(attemptsError);

    return success({
      assignment,
      attempts: attempts ?? [],
    });
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
    return success(null);
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
  new TeacherAssignmentService(createClient),
  'teacher-assignment.service',
);
