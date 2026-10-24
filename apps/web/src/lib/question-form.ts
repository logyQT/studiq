/** A client-side validation problem with the question form. */
export type QuestionFormError = 'content_required' | 'mcq_min_answers' | 'answers_required';

/** The minimal form shape the validation rules need. */
export interface QuestionFormValues {
  type: string;
  content: string;
  answers: { content: string }[];
}

/**
 * Mirror of the server's question schema (`CreateQuestionSchema`) so an invalid
 * form is rejected inline instead of round-tripping to a silent 422:
 * content non-empty, `mcq` needs at least two options, every other non-`open`
 * type needs at least one.
 */
export function validateQuestionForm(input: QuestionFormValues): QuestionFormError | null {
  if (!input.content.trim()) return 'content_required';
  if (input.type === 'open') return null;

  const filled = input.answers.filter((answer) => answer.content.trim()).length;
  if (input.type === 'mcq' && filled < 2) return 'mcq_min_answers';
  if (filled === 0) return 'answers_required';
  return null;
}
