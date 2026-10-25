import type { RequestContext } from '@studiq/authz';
import { hiddenResultAssignmentIds, resultsHidden } from '@studiq/server/lib/assignment-visibility';
import { wrapService } from '@studiq/server/lib/observability';
import {
  IN_PROGRESS_QUESTION_SELECT,
  REVIEW_QUESTION_SELECT,
} from '@studiq/server/lib/question-view';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  SaveQuizAnswersInput,
  SubmitQuizAttemptInput,
} from '@studiq/server/models/quiz-attempt.model';
import type { SupabaseClient } from '@supabase/supabase-js';

interface DraftAnswer {
  selected_answer_id: string | null;
  text_answer: string | null;
}

/**
 * Normalise the `draft_answers` jsonb column into the answer map served to the
 * take page. Fields are copied explicitly so a tampered row can never leak
 * anything beyond the student's own selection (#331).
 */
function readDraftAnswers(value: unknown): Record<string, DraftAnswer> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const draft: Record<string, DraftAnswer> = {};
  for (const [questionId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    draft[questionId] = {
      selected_answer_id:
        typeof entry.selected_answer_id === 'string' ? entry.selected_answer_id : null,
      text_answer: typeof entry.text_answer === 'string' ? entry.text_answer : null,
    };
  }
  return draft;
}

export class QuizAttemptService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async list(ctx: RequestContext): Promise<ServiceResult<any[]>> {
    const supabase = await this.createClient();

    const { data, error } = await supabase
      .from('quiz_attempts')
      // Drafts are per-question free text; the "Quiz w trakcie" banner never
      // needs them, so they are not part of the list payload (#349).
      .select(
        'id, user_id, score, total_questions, total_points, config, started_at, completed_at, assignment_id, graded_at',
      )
      .eq('user_id', ctx.userId)
      .order('started_at', { ascending: false });

    if (error) return toDbFailure(error);

    const attempts = data ?? [];
    if (attempts.length === 0) return success([]);

    // `total_questions` includes `open` questions, which are never auto-graded
    // (#329). The history badge needs its own denominator; derived from the
    // attempt snapshot join so no counter is rewritten and no migration is needed.
    const { data: questionRows, error: questionsError } = await supabase
      .from('quiz_attempt_questions')
      .select('attempt_id, questions(type)')
      .in(
        'attempt_id',
        attempts.map((attempt) => attempt.id),
      );

    if (questionsError) return toDbFailure(questionsError);

    const gradableByAttempt = new Map<string, number>();
    for (const row of questionRows ?? []) {
      // PostgREST returns a to-one embed as an object; a missing/RLS-hidden
      // question is null and must not count as gradable.
      const type = (row.questions as { type?: string } | null)?.type;
      if (!type || type === 'open') continue;
      gradableByAttempt.set(row.attempt_id, (gradableByAttempt.get(row.attempt_id) ?? 0) + 1);
    }

    const withGradable = attempts.map((attempt) => ({
      ...attempt,
      gradable_questions: gradableByAttempt.get(attempt.id) ?? 0,
    }));

    // A direct API call must not bypass the teacher's „Pokaż wyniki” switch, even
    // though the web UI filters assignment attempts out of this list (#374).
    if (!withGradable.some((attempt) => attempt.assignment_id)) return success(withGradable);

    const hidden = await hiddenResultAssignmentIds(
      supabase,
      withGradable.map((attempt) => attempt.assignment_id),
    );
    if (isFailure(hidden)) return hidden;

    return success(
      withGradable.map((attempt) =>
        attempt.assignment_id && hidden.data.has(attempt.assignment_id)
          ? { ...attempt, score: null }
          : attempt,
      ),
    );
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

    // The review payload is a result: withhold it while the assignment's
    // „Pokaż wyniki” is off. A running attempt still resumes, so „Kontynuuj”
    // keeps working; practice attempts have no assignment flag (#374).
    if (isCompleted && attempt.assignment_id) {
      const hidden = await hiddenResultAssignmentIds(supabase, [attempt.assignment_id]);
      if (isFailure(hidden)) return hidden;
      if (hidden.data.size > 0) return failure('FORBIDDEN');
    }

    // Drafts are served as `answers` below; the raw column is never serialised.
    const { draft_answers: draftAnswers, ...attemptFields } = attempt;

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
      {
        selected_answer_id: string | null;
        text_answer: string | null;
        is_correct?: boolean;
        teacher_points?: number | null;
        teacher_feedback?: string | null;
      }
    > = {};
    if (isCompleted) {
      (answers ?? []).forEach((a) => {
        answerObj[a.question_id] = {
          selected_answer_id: a.selected_option_id,
          text_answer: a.text_answer,
          is_correct: a.is_correct,
          teacher_points: a.teacher_points,
          teacher_feedback: a.teacher_feedback,
        };
      });
    } else {
      // A running attempt resumes from the autosaved draft, not from graded rows.
      Object.assign(answerObj, readDraftAnswers(draftAnswers));
    }

    return success({
      ...attemptFields,
      questions,
      answers: answerObj,
    });
  }

  /**
   * Replace the in-progress draft with the client's current answer set (#349).
   * Full-state replace: the take page always posts everything it has, so a
   * stale tab cannot resurrect an answer the student just cleared.
   */
  async saveDraft(
    data: SaveQuizAnswersInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<{ saved: number }>> {
    const supabase = await this.createClient();

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('id, completed_at')
      .eq('id', data.attemptId)
      .eq('user_id', ctx.userId)
      .single();

    if (attemptError || !attempt) return failure('NOT_FOUND');
    if (attempt.completed_at) return failure('BAD_REQUEST');

    // Only questions that belong to this attempt can be stored, so a client
    // cannot grow the draft with junk keys.
    const { data: attemptQuestions, error: questionsError } = await supabase
      .from('quiz_attempt_questions')
      .select('question_id')
      .eq('attempt_id', data.attemptId);

    if (questionsError) return toDbFailure(questionsError);

    const allowedIds = new Set((attemptQuestions ?? []).map((q) => q.question_id));
    if (data.answers.some((a) => !allowedIds.has(a.questionId))) {
      return failure('UNPROCESSABLE_ENTITY');
    }

    const draft: Record<string, DraftAnswer> = {};
    for (const answer of data.answers) {
      draft[answer.questionId] = {
        selected_answer_id: answer.selectedAnswerId ?? null,
        text_answer: answer.textAnswer?.trim() || null,
      };
    }

    const { error: updateError } = await supabase
      .from('quiz_attempts')
      .update({ draft_answers: draft })
      .eq('id', data.attemptId)
      .eq('user_id', ctx.userId)
      // A late autosave racing a submit must not revive the draft.
      .is('completed_at', null);

    if (updateError) return toDbFailure(updateError);

    return success({ saved: Object.keys(draft).length });
  }

  async submit(
    data: SubmitQuizAttemptInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<{ score: number | null; totalQuestions: number }>> {
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
    let showResults = true;
    if (attempt.assignment_id) {
      const { data: assignment } = await supabase
        .from('teacher_assignments')
        .select('deadline, show_results')
        .eq('id', attempt.assignment_id)
        .single();

      // Fail closed: a missing row hides the result.
      showResults = !resultsHidden(assignment);

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
        // The graded rows below are the record from now on.
        draft_answers: {},
      })
      .eq('id', data.attemptId);

    if (updateError) return toDbFailure(updateError);

    const { error: answersError } = await supabase.from('student_answers').insert(answerRecords);

    if (answersError) return toDbFailure(answersError);

    return success({ score: showResults ? score : null, totalQuestions: data.answers.length });
  }
}
export const quizAttemptService = wrapService(
  new QuizAttemptService(createClient),
  'quiz-attempt.service',
);
