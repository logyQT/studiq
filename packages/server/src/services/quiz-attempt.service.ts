import type { RequestContext } from '@studiq/authz';
import { hiddenResultAssignmentIds, resultsHidden } from '@studiq/server/lib/assignment-visibility';
import { gradableQuestionCounts } from '@studiq/server/lib/gradable-questions';
import { wrapService } from '@studiq/server/lib/observability';
import { isRecord } from '@studiq/server/lib/record';
import {
  IN_PROGRESS_QUESTION_SELECT,
  REVIEW_QUESTION_SELECT,
} from '@studiq/server/lib/question-view';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { dbNested, dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import type {
  QuizAnswerEntry,
  SaveQuizAnswersInput,
  SubmitQuizAttemptInput,
} from '@studiq/server/models/quiz-attempt.model';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * One entry of the `draft_answers` jsonb column. Declared as a type alias (not
 * an interface) so it is assignable to the generated `Json` type on write.
 */
type DraftAnswer = {
  selected_answer_id: string | null;
  text_answer: string | null;
};

/** What an answer may be scored against: the question's type and its own option ids. */
type AnswerableQuestion = {
  type: string;
  optionIds: Set<string>;
};

/**
 * Normalise the `draft_answers` jsonb column into the answer map served to the
 * take page. Fields are copied explicitly so a tampered row can never leak
 * anything beyond the student's own selection (#331).
 */
function readDraftAnswers(value: unknown): Record<string, DraftAnswer> {
  if (!isRecord(value) || Array.isArray(value)) return {};

  const draft: Record<string, DraftAnswer> = {};
  for (const [questionId, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    draft[questionId] = {
      selected_answer_id:
        typeof entry.selected_answer_id === 'string' ? entry.selected_answer_id : null,
      text_answer: typeof entry.text_answer === 'string' ? entry.text_answer : null,
    };
  }
  return draft;
}

/** One row of the attempt history: the list columns plus the gradable-question
 * denominator derived from the attempt snapshot (score is withheld — `null` —
 * for assignments whose results are hidden). */
export type QuizAttemptListItem = Omit<
  Pick<
    Database['public']['Tables']['quiz_attempts']['Row'],
    | 'id'
    | 'user_id'
    | 'score'
    | 'total_questions'
    | 'total_points'
    | 'config'
    | 'started_at'
    | 'completed_at'
    | 'assignment_id'
    | 'graded_at'
  >,
  'score'
> & { score: number | null; gradable_questions: number };

export class QuizAttemptService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  /**
   * Loads the signed-in student's in-progress attempt for a write and refuses
   * an answer sheet that does not fit it. Both the draft save and the submit go
   * through this gate, so the two paths cannot drift again (#1065).
   *
   * The storage contract is one `student_answers` row per question: the answer
   * value carries the selection. An entry for a question the attempt never
   * asked is therefore not something the take page can produce — it feeds the
   * per-question accuracy index (#204) and, on a practice attempt, adds to the
   * score. The attempt's own size is also the authoritative payload bound: with
   * every entry in-attempt, a longer sheet can only be junk.
   *
   * The value is gated here too (#1161): scoring looks a choice up by option id
   * alone, so an option belonging to another question would otherwise be scored
   * as correct for this one. The same query that lists the attempt's questions
   * loads each question's type and option ids, and the whole payload is refused
   * before either write path scores or stores anything.
   */
  private async loadAnswerableAttempt(
    supabase: SupabaseClient<Database>,
    attemptId: string,
    userId: string,
    answers: readonly QuizAnswerEntry[],
  ): Promise<
    ServiceResult<{
      id: string;
      assignment_id: string | null;
      questions: Map<string, AnswerableQuestion>;
    }>
  > {
    const { data: attempt, error } = await supabase
      .from('quiz_attempts')
      .select('id, assignment_id, completed_at')
      .eq('id', attemptId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !attempt) return failure('NOT_FOUND');
    if (attempt.completed_at) return failure('BAD_REQUEST');

    const { data: attemptQuestions, error: questionsError } = await supabase
      .from('quiz_attempt_questions')
      .select('question_id, questions(type, question_options(id))')
      .eq('attempt_id', attemptId);

    if (questionsError) return toDbFailure(questionsError);

    const allowedIds = new Set<string>();
    const questions = new Map<string, AnswerableQuestion>();
    for (const row of dbRows(attemptQuestions)) {
      allowedIds.add(row.question_id);
      // PostgREST types a to-one embed as always present, but an RLS-hidden
      // question arrives as null; an answer to it cannot be gated.
      const embed = dbNested(row.questions);
      if (!embed?.type) continue;
      questions.set(row.question_id, {
        type: embed.type,
        optionIds: new Set(dbRows(embed.question_options).map((option) => option.id)),
      });
    }

    // Distinct ids, so a draft that re-sends one question (last entry wins)
    // is not measured as two answers.
    if (new Set(answers.map((answer) => answer.questionId)).size > allowedIds.size) {
      return failure('UNPROCESSABLE_ENTITY', [
        { code: 'custom', path: ['answers'], message: ValidationErrorCode.TOO_MANY },
      ]);
    }

    const outsideIndex = answers.findIndex((answer) => !allowedIds.has(answer.questionId));
    if (outsideIndex !== -1) {
      return failure('UNPROCESSABLE_ENTITY', [
        {
          code: 'custom',
          path: ['answers', outsideIndex, 'questionId'],
          message: ValidationErrorCode.INVALID_INPUT,
        },
      ]);
    }

    for (const [index, answer] of answers.entries()) {
      const question = questions.get(answer.questionId);
      if (!question) {
        return failure('UNPROCESSABLE_ENTITY', [
          {
            code: 'custom',
            path: ['answers', index, 'questionId'],
            message: ValidationErrorCode.INVALID_INPUT,
          },
        ]);
      }

      // A skip carries no value: it is stored as nothing and scores nothing.
      if (answer.skipped) continue;

      if (answer.selectedAnswerId !== undefined) {
        if (question.type === 'open' || !question.optionIds.has(answer.selectedAnswerId)) {
          return failure('UNPROCESSABLE_ENTITY', [
            {
              code: 'custom',
              path: ['answers', index, 'selectedAnswerId'],
              message: ValidationErrorCode.INVALID_INPUT,
            },
          ]);
        }
        continue;
      }

      // The schema already requires exactly one kind; a caller that bypassed it
      // must not slip an entry with no value past the gate.
      if (answer.textAnswer === undefined) {
        return failure('UNPROCESSABLE_ENTITY', [
          {
            code: 'custom',
            path: ['answers', index],
            message: ValidationErrorCode.REQUIRED,
          },
        ]);
      }

      if (question.type !== 'open') {
        return failure('UNPROCESSABLE_ENTITY', [
          {
            code: 'custom',
            path: ['answers', index, 'textAnswer'],
            message: ValidationErrorCode.INVALID_INPUT,
          },
        ]);
      }
    }

    return success({ id: attempt.id, assignment_id: attempt.assignment_id, questions });
  }

  async list(ctx: RequestContext): Promise<ServiceResult<QuizAttemptListItem[]>> {
    const supabase = await this.clientFactory();

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

    const attempts = dbRows(data);
    if (attempts.length === 0) return success([]);

    // `total_questions` includes `open` questions, which are never auto-graded
    // (#329). The history badge needs its own denominator; the shared helper
    // derives it from the attempt snapshot join so no counter is rewritten and
    // no migration is needed — and so the stats aggregates use the same rule
    // (#619).
    const gradable = await gradableQuestionCounts(
      supabase,
      attempts.map((attempt) => attempt.id),
    );
    if (isFailure(gradable)) return gradable;

    const withGradable = attempts.map((attempt) => ({
      ...attempt,
      gradable_questions: gradable.data.get(attempt.id) ?? 0,
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
    const supabase = await this.clientFactory();

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('id', attemptId)
      .eq('user_id', ctx.userId)
      .maybeSingle();

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

    const questions = dbRows(attemptQuestions)
      .toSorted((a, b) => a.order_index - b.order_index)
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
      dbRows(answers).forEach((a) => {
        // `student_answers.question_id` is nullable (`ON DELETE SET NULL`); a row
        // whose question is gone cannot be keyed, and `question_id = NULL`
        // never reached a client answer before either.
        if (!a.question_id) return;
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
    const supabase = await this.clientFactory();

    const attempt = await this.loadAnswerableAttempt(
      supabase,
      data.attemptId,
      ctx.userId,
      data.answers,
    );
    if (isFailure(attempt)) return attempt;

    const draft: Record<string, DraftAnswer> = {};
    for (const answer of data.answers) {
      // A skip removes the key instead of writing it, so a cleared answer
      // disappears from the full-state replace and the last entry still wins.
      if (answer.skipped) {
        delete draft[answer.questionId];
        continue;
      }
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
    const supabase = await this.clientFactory();

    // Refuse the whole payload before scoring, completing the attempt or writing
    // a single row: the request must only carry this attempt's own questions.
    const attemptResult = await this.loadAnswerableAttempt(
      supabase,
      data.attemptId,
      ctx.userId,
      data.answers,
    );
    if (isFailure(attemptResult)) return attemptResult;
    const attempt = attemptResult.data;

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
      for (const row of dbRows(rows)) {
        // `question_id` is nullable (`ON DELETE SET NULL`); a row without a
        // question cannot award points to any answer.
        if (!row.question_id) continue;
        assignmentPoints.set(row.question_id, row.points);
      }
    }

    let score = 0;
    const answerRecords = [];
    const awardedQuestions = new Set<string>();

    for (const ans of data.answers) {
      // A skipped question was never answered: no row to store, nothing to score.
      if (ans.skipped) continue;

      // The gate already refused an unresolved question; this fallback is only
      // what `Map.get` returns for a missing key.
      const questionType = attempt.questions.get(ans.questionId)?.type ?? null;
      const isOpen = questionType === 'open';
      const textAnswer = ans.textAnswer?.trim() || null;

      let isCorrect = false;
      if (!isOpen && ans.selectedAnswerId) {
        const { data: answer } = await supabase
          .from('question_options')
          .select('is_correct')
          // Scoped to the question even though the value gate already checked
          // it, so a scoring lookup can never read another question's key.
          .eq('id', ans.selectedAnswerId)
          .eq('question_id', ans.questionId)
          .single();
        isCorrect = answer?.is_correct ?? false;
      }
      if (isCorrect && !awardedQuestions.has(ans.questionId)) {
        // One row per question is the write contract (#1065) and the schema
        // rejects a repeated question id, so this only covers a caller that
        // bypasses it: a question must never be counted twice.
        awardedQuestions.add(ans.questionId);
        score += attempt.assignment_id ? (assignmentPoints.get(ans.questionId) ?? 0) : 1;
      }
      answerRecords.push({
        question_id: ans.questionId,
        question_type: questionType,
        selected_option_id: isOpen ? null : (ans.selectedAnswerId ?? null),
        text_answer: isOpen ? textAnswer : null,
        is_correct: isCorrect,
      });
    }

    // The sheet and the completion are one transaction (#1064): the function
    // locks the attempt, inserts the rows, then stamps `completed_at` last. A
    // failing insert rolls both back, so the attempt stays open with its draft
    // and the next submit can still finish it — as two separate writes, the
    // completion committed first and the retry was refused as a re-submit.
    //
    // The row lock inside the function is also the arbiter #1066 relies on: two
    // submits that both pass the read gate serialise there, the loser re-reads
    // `completed_at` set, writes nothing and answers no rows — the same
    // BAD_REQUEST as any later re-submit.
    const { data: completed, error: submitError } = await supabase.rpc('submit_quiz_attempt', {
      p_attempt_id: data.attemptId,
      p_user_id: ctx.userId,
      p_score: score,
      p_answers: answerRecords,
    });

    if (submitError) return toDbFailure(submitError);
    if (dbRows(completed).length === 0) return failure('BAD_REQUEST');

    return success({ score: showResults ? score : null, totalQuestions: data.answers.length });
  }
}
export const quizAttemptService = wrapService(
  new QuizAttemptService(createClient),
  'quiz-attempt.service',
);
