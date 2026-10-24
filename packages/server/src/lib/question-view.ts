/**
 * Column projections for question payloads served to students.
 *
 * While an attempt is still in progress the browser may only receive the
 * question content and the option texts. The answer key
 * (`question_options.is_correct`, `questions.explanation`) and the generated
 * `questions.search_vector` (which indexes the explanation) must never leave
 * the database before submission (#331).
 *
 * Always project explicit columns here; never `*`.
 */
export const IN_PROGRESS_QUESTION_SELECT =
  'id, content, type, question_answers:question_options(id, content)';

/** Same payload plus the answer key — only for a completed attempt. */
export const REVIEW_QUESTION_SELECT =
  'id, content, type, explanation, question_answers:question_options(id, content, is_correct)';
