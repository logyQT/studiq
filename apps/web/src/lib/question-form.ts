import {
  EXPLANATION_MAX_LENGTH,
  EXPLANATION_MIN_LENGTH,
  MODEL_ANSWER_MAX_LENGTH,
  questionTextIssues,
} from '@studiq/server/lib/question-explanation';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { ApiError, getFieldErrorCode } from '@/lib/api';

/** The fields of the authoring form that can carry an error. */
export type QuestionFormField = 'content' | 'answers' | 'explanation' | 'modelAnswer';

/**
 * A per-field problem, as a `QuestionForm` message key. The dialog renders each one under its
 * own field: a 422 that says "explanation" has to point at the explanation box, not at a toast.
 */
export type QuestionFormErrors = Partial<Record<QuestionFormField, string>>;

/** The item the dialog hands to its caller to save. */
export interface QuestionFormPayload {
  content: string;
  type: string;
  explanation?: string;
  modelAnswer?: string;
  topicIds?: string[];
  bankId: string;
  answers: { content: string; isCorrect: boolean; orderIndex: number }[];
}

/** The minimal form shape the rules need. */
export interface QuestionFormValues {
  type: string;
  content: string;
  explanation?: string;
  modelAnswer?: string;
  answers: { content: string }[];
}

/**
 * Wire code -> `QuestionForm` message key. The server's authoring rules (R16/R17) and the field
 * schema answer the same codes, so one map covers both the instant check and a 422.
 */
const MESSAGE_KEYS: Record<string, string> = {
  [ValidationErrorCode.REQUIRED]: 'required',
  [ValidationErrorCode.TOO_SHORT]: 'too_short',
  [ValidationErrorCode.TOO_LONG]: 'too_long',
  [ValidationErrorCode.INVALID_INPUT]: 'invalid',
  [ValidationErrorCode.EXPLANATION_REQUIRED]: 'explanation_required',
  [ValidationErrorCode.EXPLANATION_TOO_SHORT]: 'explanation_too_short',
  [ValidationErrorCode.EXPLANATION_NAMES_OPTION]: 'explanation_names_option',
  [ValidationErrorCode.EXPLANATION_QUOTES_OPTION]: 'explanation_quotes_option',
  [ValidationErrorCode.MODEL_ANSWER_REQUIRED]: 'model_answer_required',
};

function messageKey(code: string | undefined): string | undefined {
  return code ? MESSAGE_KEYS[code] : undefined;
}

/**
 * Mirror of the server's authoring rules (`CreateQuestionSchema` + `questionTextIssues`) so an
 * invalid form is rejected inline instead of round-tripping to a silent 422: content non-empty,
 * `mcq` needs at least two options, `true_false` both of its two, a choice item a teaching-length
 * explanation that does not hand over an option, an open item a model answer.
 */
export function validateQuestionForm(input: QuestionFormValues): QuestionFormErrors | null {
  const errors: QuestionFormErrors = {};
  if (!input.content.trim()) errors.content = 'content_required';

  if (input.type !== 'open') {
    const filled = input.answers.filter((answer) => answer.content.trim()).length;
    if (input.type === 'true_false' && filled < 2) errors.answers = 'answers_required';
    else if (input.type === 'mcq' && filled < 2) errors.answers = 'mcq_min_answers';
    else if (filled === 0) errors.answers = 'answers_required';
  }

  for (const issue of questionTextIssues({
    type: input.type,
    explanation: input.explanation,
    modelAnswer: input.modelAnswer,
    options: input.answers.map((answer) => answer.content),
  })) {
    const field = issue.path[0];
    if (field === 'explanation' || field === 'modelAnswer') {
      errors[field] = messageKey(issue.message) ?? 'invalid';
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * What a save answered. `saved` closes the dialog; a failure either names the fields the server
 * refused or is a plain failure the dialog reports once.
 */
export type QuestionFormResult = { saved: true } | { saved: false; errors?: QuestionFormErrors };

/** The form's bounds, so the counters next to the fields cannot drift from the rules. */
export const QUESTION_FORM_LIMITS = {
  explanationMin: EXPLANATION_MIN_LENGTH,
  explanationMax: EXPLANATION_MAX_LENGTH,
  modelAnswerMax: MODEL_ANSWER_MAX_LENGTH,
} as const;

/**
 * The 422 a save can still return (the server is the authority, and a rule it learns about the
 * merged item cannot be reproduced here). Per-field issues become per-field messages; anything
 * else is not a field problem and returns `null` so the caller can fall back to a toast.
 */
export function fieldErrorsFromApiError(error: unknown): QuestionFormErrors | null {
  if (!(error instanceof ApiError)) return null;

  const errors: QuestionFormErrors = {};
  for (const field of ['content', 'answers', 'explanation', 'modelAnswer'] as const) {
    const key = messageKey(getFieldErrorCode(error, field));
    if (key) errors[field] = key;
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Exactly two `true_false` rows: keep non-empty existing text, fill missing rows
 * with the current-locale labels, and mark exactly one row correct (first flagged
 * row, else the first row). T/F is binary, so extra rows are trimmed and legacy
 * 0/1-option questions get padded instead of being left uneditable.
 */
export function normalizeTrueFalseAnswers(
  answers: { content: string; isCorrect: boolean }[],
  labels: { trueLabel: string; falseLabel: string },
): { content: string; isCorrect: boolean }[] {
  const texts = [
    answers[0]?.content.trim() ? answers[0].content : labels.trueLabel,
    answers[1]?.content.trim() ? answers[1].content : labels.falseLabel,
  ];
  const correctIndex = answers[0]?.isCorrect ? 0 : answers[1]?.isCorrect ? 1 : 0;
  return texts.map((content, index) => ({ content, isCorrect: index === correctIndex }));
}
