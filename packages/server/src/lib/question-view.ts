/**
 * Column projections for question payloads served by the app.
 *
 * The answer key (`question_options.is_correct`) and `questions.explanation` never leave the
 * server for a reader: the database grants neither to `authenticated`
 * (`20261114120000_question_option_key_boundary.sql`). Staff paths add them back through
 * `readQuestionKeys` (service role, ids from the query they just ran).
 *
 * Always project explicit columns here; never `*`.
 */

/** The option columns any reader may select. */
export const OPTION_READER_COLUMNS = 'id, content, order_index, match_group, match_side';

/** One question with its options and no key — the take, review and list shape. */
export const QUESTION_PAYLOAD_SELECT =
  `id, content, type, question_answers:question_options(${OPTION_READER_COLUMNS})` as const;
