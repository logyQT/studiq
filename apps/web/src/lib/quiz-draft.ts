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
 * The take page's photo list from the photos the attempt already has (#1544). Only an open
 * question shows photos. The upload does not keep the file's name, so `nameOf` gives each one
 * a name by its number within the question, from 1.
 */
export function seedQuizPhotos(
  questions: DraftQuestion[],
  images: Record<string, string[] | undefined> | undefined,
  nameOf: (position: number) => string,
): Record<string, Array<{ url: string; name: string }>> {
  const seeded: Record<string, Array<{ url: string; name: string }>> = {};

  for (const question of questions) {
    const urls = question.type === 'open' ? (images?.[question.id] ?? []) : [];
    if (urls.length === 0) continue;
    seeded[question.id] = urls.map((url, index) => ({ url, name: nameOf(index + 1) }));
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

/**
 * Positions (from 0) of the questions with no answer: no selected option, or no text beyond
 * whitespace. An attached photo also answers a question.
 *
 * This differs from `toSaveAnswersPayload` on a photo with no text: that payload marks the
 * question skipped, because the photo is stored by its own upload, not by the submission.
 */
export function unansweredIndexes(
  questions: DraftQuestion[],
  answers: Record<string, string | undefined>,
  photos: Record<string, readonly unknown[] | undefined> = {},
): number[] {
  return questions.flatMap((question, index) =>
    answers[question.id]?.trim() || photos[question.id]?.length ? [] : [index],
  );
}
