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
  skipped?: true;
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
 * Iterates the questions so an unknown id can never be sent, and emits exactly
 * one entry per question: an explicit `skipped` replaces a dropped entry, which
 * is how a cleared answer removes the previously saved one (#1161).
 */
export function toSaveAnswersPayload(
  questions: DraftQuestion[],
  answers: Record<string, string | undefined>,
): SavedAnswer[] {
  return questions.map((question): SavedAnswer => {
    const value = answers[question.id]?.trim();
    if (!value) return { questionId: question.id, skipped: true };
    return question.type === 'open'
      ? { questionId: question.id, textAnswer: value }
      : { questionId: question.id, selectedAnswerId: value };
  });
}
