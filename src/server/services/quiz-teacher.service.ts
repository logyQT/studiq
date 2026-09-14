import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';
import type {
  AddQuizQuestionsInput,
  BulkSaveQuizInput,
  CreateQuizInput,
  ReorderQuizQuestionsInput,
  UpdateQuizInput,
} from '@/server/models';

export class QuizTeacherService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async create(data: CreateQuizInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: quiz, error } = await supabase
      .from('quizzes')
      .insert({
        organization_id: ctx.activeOrgId,
        created_by: ctx.userId,
        name: data.name,
        description: data.description,
      })
      .select()
      .single();

    if (error) return toDbFailure(error);
    return success(quiz);
  }

  async list(ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data, error } = await supabase
      .from('quizzes')
      .select('*, quiz_questions(count)')
      .eq('organization_id', ctx.activeOrgId)
      .order('created_at', { ascending: false });

    if (error) return toDbFailure(error);
    return success(data ?? []);
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: quiz, error } = await supabase
      .from('quizzes')
      .select('*, quiz_questions(*, question:questions(id, content, type))')
      .eq('id', id)
      .single();

    if (error) return toDbFailure(error);
    if (!quiz) return failure('NOT_FOUND');
    if (quiz.organization_id !== ctx.activeOrgId) return failure('NOT_FOUND');

    return success(quiz);
  }

  async bulkSave(
    id: string,
    data: BulkSaveQuizInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: quiz, error: fetchError } = await supabase
      .from('quizzes')
      .select('organization_id')
      .eq('id', id)
      .single();

    if (fetchError) return toDbFailure(fetchError);
    if (!quiz) return failure('NOT_FOUND');
    if (quiz.organization_id !== ctx.activeOrgId) return failure('FORBIDDEN');

    const { error: updateError } = await supabase
      .from('quizzes')
      .update({
        name: data.name,
        description: data.description ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) return toDbFailure(updateError);

    const { error: deleteError } = await supabase.from('quiz_questions').delete().eq('quiz_id', id);

    if (deleteError) return toDbFailure(deleteError);

    if (data.questions.length > 0) {
      const { error: insertError } = await supabase.from('quiz_questions').insert(
        data.questions.map((q) => ({
          quiz_id: id,
          question_id: q.question_id,
          order_index: q.order_index,
          points: q.points,
        })),
      );

      if (insertError) return toDbFailure(insertError);
    }

    const { data: updated, error: selectError } = await supabase
      .from('quizzes')
      .select('*, quiz_questions(*, question:questions(id, content, type)))')
      .eq('id', id)
      .single();

    if (selectError) return toDbFailure(selectError);
    return success(updated);
  }

  async update(
    id: string,
    data: UpdateQuizInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: quiz, error } = await supabase
      .from('quizzes')
      .select('organization_id')
      .eq('id', id)
      .single();

    if (error) return toDbFailure(error);
    if (!quiz) return failure('NOT_FOUND');
    if (quiz.organization_id !== ctx.activeOrgId) return failure('NOT_FOUND');

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    updateData.updated_at = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from('quizzes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) return toDbFailure(updateError);
    return success(updated);
  }

  async delete(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: quiz, error } = await supabase
      .from('quizzes')
      .select('organization_id')
      .eq('id', id)
      .single();

    if (error) return toDbFailure(error);
    if (!quiz) return failure('NOT_FOUND');
    if (quiz.organization_id !== ctx.activeOrgId) return failure('NOT_FOUND');

    const { error: deleteError } = await supabase.from('quizzes').delete().eq('id', id);
    if (deleteError) return toDbFailure(deleteError);
    return success(null);
  }

  async addQuestions(
    id: string,
    data: AddQuizQuestionsInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select('organization_id')
      .eq('id', id)
      .single();

    if (quizError) return toDbFailure(quizError);
    if (!quiz) return failure('NOT_FOUND');
    if (quiz.organization_id !== ctx.activeOrgId) return failure('NOT_FOUND');

    // Get current max order_index
    const { data: maxRow } = await supabase
      .from('quiz_questions')
      .select('order_index')
      .eq('quiz_id', id)
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextIndex = (maxRow?.order_index ?? -1) + 1;

    // Get existing question IDs to skip duplicates
    const { data: existing } = await supabase
      .from('quiz_questions')
      .select('question_id')
      .eq('quiz_id', id);

    const existingIds = new Set(
      (existing ?? []).map((r: { question_id: string }) => r.question_id),
    );

    const rows = data.questionIds
      .filter((qid) => !existingIds.has(qid))
      .map((questionId) => ({
        quiz_id: id,
        question_id: questionId,
        order_index: nextIndex++,
        points: 1,
      }));

    if (rows.length === 0) return success([]);

    const { data: inserted, error: insertError } = await supabase
      .from('quiz_questions')
      .insert(rows)
      .select();

    if (insertError) return toDbFailure(insertError);
    return success(inserted ?? []);
  }

  async removeQuestion(
    id: string,
    questionId: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select('organization_id')
      .eq('id', id)
      .single();

    if (quizError) return toDbFailure(quizError);
    if (!quiz) return failure('NOT_FOUND');
    if (quiz.organization_id !== ctx.activeOrgId) return failure('NOT_FOUND');

    const { error } = await supabase
      .from('quiz_questions')
      .delete()
      .eq('quiz_id', id)
      .eq('question_id', questionId);

    if (error) return toDbFailure(error);
    return success(null);
  }

  async reorderQuestions(
    id: string,
    data: ReorderQuizQuestionsInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select('organization_id')
      .eq('id', id)
      .single();

    if (quizError) return toDbFailure(quizError);
    if (!quiz) return failure('NOT_FOUND');
    if (quiz.organization_id !== ctx.activeOrgId) return failure('NOT_FOUND');

    // Update order_index for each question sequentially
    for (let i = 0; i < data.questionIds.length; i++) {
      const { error: updateError } = await supabase
        .from('quiz_questions')
        .update({ order_index: i })
        .eq('quiz_id', id)
        .eq('question_id', data.questionIds[i]);

      if (updateError) return toDbFailure(updateError);
    }

    return success(null);
  }

  async createAssignment(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    // 1. Get quiz with questions
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select('*, quiz_questions(*)')
      .eq('id', id)
      .single();

    if (quizError) return toDbFailure(quizError);
    if (!quiz) return failure('NOT_FOUND');
    if (quiz.organization_id !== ctx.activeOrgId) return failure('FORBIDDEN');

    // 2. Create assignment
    const { data: assignment, error: assignError } = await supabase
      .from('teacher_assignments')
      .insert({
        organization_id: ctx.activeOrgId,
        created_by: ctx.userId,
        title: quiz.name,
        quiz_id: id,
      })
      .select()
      .single();

    if (assignError) return toDbFailure(assignError);

    // 3. Copy questions from quiz to assignment
    const questions = (quiz.quiz_questions ?? []).map(
      (q: { question_id: string; order_index: number; points: number }) => ({
        assignment_id: assignment.id,
        question_id: q.question_id,
        order_index: q.order_index,
        points: q.points,
      }),
    );

    if (questions.length > 0) {
      const { error: copyError } = await supabase.from('assignment_questions').insert(questions);

      if (copyError) return toDbFailure(copyError);
    }

    return success(assignment);
  }
}
