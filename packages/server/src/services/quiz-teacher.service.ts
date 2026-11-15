import type { RequestContext } from '@studiq/authz';
import { openQuestionIds } from '@studiq/server/lib/question-status';
import { insertAssessmentItemLinks } from '@studiq/server/lib/quiz-assignment';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { dbNested, dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  AddQuizQuestionsInput,
  BulkSaveQuizInput,
  CreateQuizInput,
  ReorderQuizQuestionsInput,
  UpdateQuizInput,
} from '@studiq/server/models/quiz.model';
import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/**
 * A quiz outside the caller's active org is indistinguishable from a missing one on reads,
 * while the flows that had already verified ownership answer the same row with FORBIDDEN.
 */
function ownedQuiz<T extends { organization_id: string }>(
  quiz: T | null,
  error: PostgrestError | null,
  ctx: RequestContext,
  foreignOrgError: 'NOT_FOUND' | 'FORBIDDEN',
): ServiceResult<T> {
  if (error) return toDbFailure(error);
  if (!quiz) return failure('NOT_FOUND');
  if (quiz.organization_id !== ctx.activeOrgId) return failure(foreignOrgError);
  return success(quiz);
}

export class QuizTeacherService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  /** The read view: the quiz, its questions and the content each question points at. */
  private async readQuiz(id: string, ctx: RequestContext) {
    const supabase = await this.clientFactory();

    const { data: quiz, error } = await supabase
      .from('quizzes')
      .select('*, quiz_questions(*, question:questions(id, content, type, status))')
      .eq('id', id)
      .maybeSingle();

    const owned = ownedQuiz(quiz, error, ctx, 'NOT_FOUND');
    if (!owned.success) return owned;

    // A deleted item leaves the builder (it is hidden from authoring); the quiz row stays.
    return success({
      ...owned.data,
      quiz_questions: dbRows(owned.data.quiz_questions).filter(
        (row) => dbNested(row.question)?.status !== 'deleted',
      ),
    });
  }

  /**
   * The failure that hides a missing or foreign quiz, or `null` when the caller owns it;
   * the single-row writes below need the verdict, not the row.
   */
  private async quizAccessFailure(
    supabase: SupabaseClient<Database>,
    id: string,
    ctx: RequestContext,
    foreignOrgError: 'NOT_FOUND' | 'FORBIDDEN' = 'NOT_FOUND',
  ): Promise<ServiceResult<never> | null> {
    const { data: quiz, error } = await supabase
      .from('quizzes')
      .select('organization_id')
      .eq('id', id)
      .maybeSingle();

    const owned = ownedQuiz(quiz, error, ctx, foreignOrgError);
    return owned.success ? null : owned;
  }

  async create(data: CreateQuizInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    // quizzes.organization_id is NOT NULL: without a verified active org there is no tenant to
    // create the quiz in. Guard before inserting — a null org would fail with 23502 → 400,
    // the wrong contract for an authenticated caller that simply has no active org (#148).
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    const supabase = await this.clientFactory();

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
    const supabase = await this.clientFactory();

    // Quizzes are strictly org-scoped, and postgrest serialises a null value as
    // `eq.null`, which Postgres rejects for a uuid column (22P02 → 500). A caller
    // without a membership-verified active org is authenticated but has no tenant
    // scope, so reject the request before it reaches the database (#147).
    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data, error } = await supabase
      .from('quizzes')
      .select('*, quiz_questions(question_id, question:questions(status))')
      .eq('organization_id', ctx.activeOrgId)
      .order('created_at', { ascending: false });

    if (error) return toDbFailure(error);

    // The card count must not include items the author deleted (#1171); PostgREST cannot filter
    // an embedded aggregate, so the count is derived from the same rows the builder reads.
    return success(
      dbRows(data).map(({ quiz_questions, ...quiz }) => ({
        ...quiz,
        quiz_questions: [
          {
            count: dbRows(quiz_questions).filter(
              (row) => dbNested(row.question)?.status !== 'deleted',
            ).length,
          },
        ],
      })),
    );
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    return this.readQuiz(id, ctx);
  }

  async bulkSave(
    id: string,
    data: BulkSaveQuizInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const denied = await this.quizAccessFailure(supabase, id, ctx, 'FORBIDDEN');
    if (denied) return denied;

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
    const supabase = await this.clientFactory();

    const denied = await this.quizAccessFailure(supabase, id, ctx);
    if (denied) return denied;

    const updateData: Database['public']['Tables']['quizzes']['Update'] = {};
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
    const supabase = await this.clientFactory();

    const denied = await this.quizAccessFailure(supabase, id, ctx);
    if (denied) return denied;

    const { error: deleteError } = await supabase.from('quizzes').delete().eq('id', id);
    if (deleteError) return toDbFailure(deleteError);
    return success(null);
  }

  async addQuestions(
    id: string,
    data: AddQuizQuestionsInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const denied = await this.quizAccessFailure(supabase, id, ctx);
    if (denied) return denied;

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
      dbRows(existing).map((r: { question_id: string }) => r.question_id),
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
    return success(dbRows(inserted));
  }

  async removeQuestion(
    id: string,
    questionId: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const denied = await this.quizAccessFailure(supabase, id, ctx);
    if (denied) return denied;

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
    const supabase = await this.clientFactory();

    const denied = await this.quizAccessFailure(supabase, id, ctx);
    if (denied) return denied;

    // Update order_index for each question sequentially
    for (const [i, questionId] of data.questionIds.entries()) {
      const { error: updateError } = await supabase
        .from('quiz_questions')
        .update({ order_index: i })
        .eq('quiz_id', id)
        .eq('question_id', questionId);

      if (updateError) return toDbFailure(updateError);
    }

    return success(null);
  }

  async createAssignment(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    // 1. Get quiz with questions
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select('*, quiz_questions(*)')
      .eq('id', id)
      .maybeSingle();

    const owned = ownedQuiz(quiz, quizError, ctx, 'FORBIDDEN');
    if (!owned.success) return owned;

    // 2. A quiz copy is a new binding and is chosen as a whole: any retired or deleted item
    // refuses the whole copy. Dropping it silently would produce an assessment with a different
    // item set than the quiz (#1171).
    const quizQuestions = dbRows(owned.data.quiz_questions).flatMap(
      (question: { question_id: string; order_index: number; points: number }) =>
        question.question_id ? [question] : [],
    );
    const open = await openQuestionIds(
      supabase,
      quizQuestions.map((question) => question.question_id),
    );
    if (!open.success) return open;
    if (open.data.size !== quizQuestions.length) return failure('UNPROCESSABLE_ENTITY');

    // 3. Create assignment
    const { data: assignment, error: assignError } = await supabase
      .from('teacher_assignments')
      .insert({
        organization_id: ctx.activeOrgId,
        created_by: ctx.userId,
        title: owned.data.name,
        quiz_id: id,
      })
      .select()
      .single();

    if (assignError) return toDbFailure(assignError);

    // 4. Copy every validated item.
    const copied = await insertAssessmentItemLinks(supabase, assignment.id, quizQuestions);
    if (!copied.success) return copied;

    return success(assignment);
  }
}
export const quizTeacherService = wrapService(
  new QuizTeacherService(createClient),
  'quiz-teacher.service',
);
