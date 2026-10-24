/** An answer as persisted in `quiz_attempts.draft_answers` / served by GET. */
export interface QuizDraftAnswer {
  selected_answer_id: string | null;
  text_answer: string | null;
}

/** The minimal question shape both helpers need. */
export interface DraftQuestion {
  id: string;
  type: string;
}

/** One entry of the autosave/submit payload. */
export interface SavedAnswer {
  questionId: string;
  selectedAnswerId?: string;
  textAnswer?: string;
}

/**
 * Turn the server's answer map into the take page's local `questionId -> value`
 * state. Open questions carry free text; everything else carries an option id.
 */
export function seedQuizAnswers(
  questions: DraftQuestion[],
  answers: Record<string, QuizDraftAnswer> | undefined,
): Record<string, string> {
  const seeded: Record<string, string> = {};

  for (const question of questions) {
    const saved = answers?.[question.id];
    if (!saved) continue;

    const value =
      question.type === 'open'
        ? (saved.text_answer?.trim() ?? '')
        : (saved.selected_answer_id ?? '');

    if (value) seeded[question.id] = value;
  }

  return seeded;
}

/**
 * Build the wire payload for both autosave and submit from the local state.
 * Iterates the questions so an unknown id can never be sent; empty values are
 * dropped, which also clears a previously saved answer.
 */
export function toSaveAnswersPayload(
  questions: DraftQuestion[],
  answers: Record<string, string | undefined>,
): SavedAnswer[] {
  return questions.flatMap((question): SavedAnswer[] => {
    const value = answers[question.id]?.trim();
    if (!value) return [];
    return question.type === 'open'
      ? [{ questionId: question.id, textAnswer: value }]
      : [{ questionId: question.id, selectedAnswerId: value }];
  });
}
