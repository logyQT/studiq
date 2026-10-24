import type { RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import {
  IN_PROGRESS_QUESTION_SELECT,
  REVIEW_QUESTION_SELECT,
} from '@studiq/server/lib/question-view';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SubmitQuizAttemptInput } from '@studiq/server/models/quiz-attempt.model';
import type { SupabaseClient } from '@supabase/supabase-js';

export class QuizAttemptService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async list(ctx: RequestContext): Promise<ServiceResult<any[]>> {
    const supabase = await this.createClient();

    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('user_id', ctx.userId)
      .order('started_at', { ascending: false });

    if (error) return toDbFailure(error);
    return success(data);
  }

  async getById(
    attemptId: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<Record<string, unknown>>> {
    const supabase = await this.createClient();

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('id', attemptId)
      .eq('user_id', ctx.userId)
      .single();

    if (attemptError || !attempt) return failure('NOT_FOUND');

    // A finished attempt is a review: it may show which option was correct and
    // the explanation. A running attempt never may (#331).
    const isCompleted = attempt.completed_at !== null;

    const { data: attemptQuestions, error: questionsError } = await supabase
      .from('quiz_attempt_questions')
      .select(
        `order_index, question_id, questions(${
          isCompleted ? REVIEW_QUESTION_SELECT : IN_PROGRESS_QUESTION_SELECT
        })`,
      )
      .eq('attempt_id', attemptId)
      .order('order_index', { ascending: true });

    if (questionsError) return toDbFailure(questionsError);

    const { data: answers, error: answersError } = await supabase
      .from('student_answers')
      .select('*')
      .eq('attempt_id', attemptId);

    if (answersError) return toDbFailure(answersError);

    const questions = (attemptQuestions ?? [])
      .sort((a, b) => a.order_index - b.order_index)
      .map((aq) => aq.questions);

    const answerObj: Record<
      string,
      { selected_answer_id: string | null; text_answer: string | null; is_correct?: boolean }
    > = {};
    (answers ?? []).forEach((a) => {
      answerObj[a.question_id] = {
        selected_answer_id: a.selected_option_id,
        text_answer: a.text_answer,
        ...(isCompleted ? { is_correct: a.is_correct } : {}),
      };
    });

    return success({
      ...attempt,
      questions,
      answers: answerObj,
    });
  }

  async submit(
    data: SubmitQuizAttemptInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<{ score: number; totalQuestions: number }>> {
    const supabase = await this.createClient();

    const { data: attempt, error: attemptCheckError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('id', data.attemptId)
      .eq('user_id', ctx.userId)
      .single();

    if (attemptCheckError || !attempt) return failure('NOT_FOUND');
    if (attempt.completed_at) return failure('BAD_REQUEST');

    // Check deadline if this attempt belongs to an assignment
    if (attempt.assignment_id) {
      const { data: assignment } = await supabase
        .from('teacher_assignments')
        .select('deadline')
        .eq('id', attempt.assignment_id)
        .single();

      if (assignment?.deadline) {
        const graceEnd = new Date(assignment.deadline);
        graceEnd.setSeconds(graceEnd.getSeconds() + 60);
        if (new Date() > graceEnd) {
          return failure('GONE');
        }
      }
    }

    // Assignment attempts are scored in points, practice quizzes in correct
    // answers. Load the per-question points once when this is an assignment.
    const assignmentPoints = new Map<string, number>();
    if (attempt.assignment_id) {
      const { data: rows, error: pointsError } = await supabase
        .from('assignment_questions')
        .select('question_id, points')
        .eq('assignment_id', attempt.assignment_id);

      if (pointsError) return toDbFailure(pointsError);
      for (const row of rows ?? []) {
        assignmentPoints.set(row.question_id, row.points ?? 0);
      }
    }

    let score = 0;
    const answerRecords = [];
    const awardedQuestions = new Set<string>();

    // One lookup per submit so an `open` answer is stored as text (never as an
    // option id) and only auto-graded types are scored (#176).
    const questionIds = [...new Set(data.answers.map((a) => a.questionId))];
    let questionTypeById = new Map<string, string>();
    if (questionIds.length > 0) {
      const { data: questionRows, error: questionsError } = await supabase
        .from('questions')
        .select('id, type')
        .in('id', questionIds);

      if (questionsError) return toDbFailure(questionsError);

      questionTypeById = new Map((questionRows ?? []).map((q) => [q.id, q.type]));
    }

    for (const ans of data.answers) {
      const questionType = questionTypeById.get(ans.questionId) ?? null;
      const textAnswer = ans.textAnswer?.trim() || null;
      // Fall back to "open iff text was sent" when the question row is missing.
      const isOpen = questionType === 'open' || (questionType === null && textAnswer !== null);

      let isCorrect = false;
      if (!isOpen && ans.selectedAnswerId) {
        const { data: answer } = await supabase
          .from('question_options')
          .select('is_correct')
          .eq('id', ans.selectedAnswerId)
          .single();
        isCorrect = answer?.is_correct ?? false;
      }
      if (isCorrect && !awardedQuestions.has(ans.questionId)) {
        // One question can produce several answer rows (multi-select /
        // matching), so award its points at most once.
        awardedQuestions.add(ans.questionId);
        score += attempt.assignment_id ? (assignmentPoints.get(ans.questionId) ?? 0) : 1;
      }
      answerRecords.push({
        attempt_id: data.attemptId,
        question_id: ans.questionId,
        question_type: questionType,
        selected_option_id: isOpen ? null : (ans.selectedAnswerId ?? null),
        text_answer: isOpen ? textAnswer : null,
        is_correct: isCorrect,
      });
    }

    const { error: updateError } = await supabase
      .from('quiz_attempts')
      .update({
        score,
        completed_at: new Date().toISOString(),
      })
      .eq('id', data.attemptId);

    if (updateError) return toDbFailure(updateError);

    const { error: answersError } = await supabase.from('student_answers').insert(answerRecords);

    if (answersError) return toDbFailure(answersError);

    return success({ score, totalQuestions: data.answers.length });
  }
}
export const quizAttemptService = wrapService(
  new QuizAttemptService(createClient),
  'quiz-attempt.service',
);
