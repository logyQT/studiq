/** A client-side validation problem with the question form. */
export type QuestionFormError = 'content_required' | 'mcq_min_answers' | 'answers_required';

/** The minimal form shape the validation rules need. */
export interface QuestionFormValues {
  type: string;
  content: string;
  answers: { content: string }[];
}

/** Current-locale wording for the two `true_false` options. */
export interface TrueFalseLabels {
  trueLabel: string;
  falseLabel: string;
}

/** An option row as edited in the question form. */
interface TrueFalseAnswer {
  content: string;
  isCorrect: boolean;
}

/**
 * Mirror of the server's question schema (`CreateQuestionSchema`) so an invalid
 * form is rejected inline instead of round-tripping to a silent 422:
 * content non-empty, `mcq` needs at least two options, `true_false` needs both
 * of its two options, every other non-`open` type needs at least one.
 */
export function validateQuestionForm(input: QuestionFormValues): QuestionFormError | null {
  if (!input.content.trim()) return 'content_required';
  if (input.type === 'open') return null;

  const filled = input.answers.filter((answer) => answer.content.trim()).length;
  if (input.type === 'true_false') return filled < 2 ? 'answers_required' : null;
  if (input.type === 'mcq' && filled < 2) return 'mcq_min_answers';
  if (filled === 0) return 'answers_required';
  return null;
}

/**
 * Exactly two `true_false` rows: keep non-empty existing text, fill missing rows
 * with the current-locale labels, and mark exactly one row correct (first flagged
 * row, else the first row). T/F is binary, so extra rows are trimmed and legacy
 * 0/1-option questions get padded instead of being left uneditable.
 */
export function normalizeTrueFalseAnswers(
  answers: TrueFalseAnswer[],
  labels: TrueFalseLabels,
): TrueFalseAnswer[] {
  const texts = [
    answers[0]?.content.trim() ? answers[0].content : labels.trueLabel,
    answers[1]?.content.trim() ? answers[1].content : labels.falseLabel,
  ];
  const correctIndex = answers[0]?.isCorrect ? 0 : answers[1]?.isCorrect ? 1 : 0;
  return texts.map((content, index) => ({ content, isCorrect: index === correctIndex }));
}
