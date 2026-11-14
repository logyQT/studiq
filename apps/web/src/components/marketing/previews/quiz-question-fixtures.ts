import type { QuizQuestionViewQuestion } from '@/components/quiz/quiz-question-view';

/**
 * Preview data only — never a seed, never a fetch.
 *
 * Subjects on purpose: biology, history, driving theory, English and SQL. The
 * product is for any exam, and a medical-only example quietly told visitors it was
 * a med-school tool.
 *
 * Both locales are authored, not translated at render time: the marketing page is
 * Polish by default and English second, and a Polish card under an English page is
 * the mixed-locale mistake DESIGN.md bans.
 *
 * `language` is an open-answer (fill-the-gap) card. It stays available to the
 * component's own tests but is **not** in the sequence the page steps through,
 * because that question type is deferred — advertising a screen nobody can reach
 * yet would be a promise the product does not keep.
 */
export type QuizFixtureLocale = 'pl' | 'en';

export const QUIZ_SUBJECTS = ['biology', 'history', 'driving', 'language', 'tech'] as const;
export type QuizSubject = (typeof QUIZ_SUBJECTS)[number];

/**
 * The sequence the marketing demo steps through, and the only questions its
 * result is computed from.
 *
 * `language` is an open-answer (fill-the-gap) fixture: it stays available to the
 * component's own tests but is **not** in this sequence, because that question
 * type is deferred — advertising a screen nobody can reach yet would be a
 * promise the product does not keep — and because an open answer has no answer
 * key to grade.
 */
export const DEMO_QUESTION_ORDER = QUIZ_SUBJECTS.filter(
  (subject) => subject !== 'language',
) as readonly QuizSubject[];

/**
 * A fixture question plus the answer key the demo's result is computed from.
 *
 * The key lives on the fixture, not on `QuizQuestionViewQuestion`: the taking
 * card must never be able to render correctness, and the demo preview is the
 * only caller that has a use for it.
 */
export interface QuizFixtureQuestion extends QuizQuestionViewQuestion {
  /** The option the finished state counts as correct; `null` when it is not graded. */
  correctOptionId: string | null;
}

/** Options share one id list per question; only the labels are localised. */
const options = (ids: readonly string[], labels: readonly string[]) =>
  ids.map((id, index) => ({ id, label: labels[index] ?? id }));

const MCQ_BIOLOGY = ['mitochondrium', 'aparat-golgiego', 'rybosom', 'lizosom'] as const;
const MCQ_DRIVING = ['yield', 'horn', 'rush', 'pass'] as const;
const MCQ_TECH = ['where', 'order', 'group', 'join'] as const;

/** One MCQ card; the field list was repeated per subject and tripped the clone gate. */
function mcq(
  stem: string,
  choices: readonly { id: string; label: string }[],
  selectedOptionId: string,
  position: number,
  correctOptionId: string,
): QuizFixtureQuestion {
  return {
    stem,
    options: choices,
    selectedOptionId,
    correctOptionId,
    textAnswer: '',
    position,
    total: 5,
    type: 'mcq',
  };
}

/**
 * A true/false card. The view renders `options` as the two buttons, so they must be
 * supplied — an empty array rendered a card with no answers at all.
 */
function trueFalse(
  stem: string,
  labels: readonly [string, string],
  selectedOptionId: string,
  position: number,
  correctOptionId: string,
): QuizFixtureQuestion {
  return {
    stem,
    options: [
      { id: 'true', label: labels[0] },
      { id: 'false', label: labels[1] },
    ],
    selectedOptionId,
    correctOptionId,
    textAnswer: '',
    position,
    total: 5,
    type: 'true_false',
  };
}

/** An open-answer card — used by tests, not by the marketing sequence. */
function open(stem: string, position: number): QuizFixtureQuestion {
  return {
    stem,
    options: [],
    selectedOptionId: null,
    // An open answer has no key: the product never auto-grades one.
    correctOptionId: null,
    textAnswer: '',
    position,
    total: 5,
    type: 'open',
  };
}

export const QUIZ_QUESTION_FIXTURES: Record<
  QuizFixtureLocale,
  Record<QuizSubject, QuizFixtureQuestion>
> = {
  pl: {
    biology: mcq(
      'Które organellum wytwarza większość ATP w komórce eukariotycznej?',
      options(MCQ_BIOLOGY, ['Mitochondrium', 'Aparat Golgiego', 'Rybosom', 'Lizosom']),
      'mitochondrium',
      1,
      'mitochondrium',
    ),
    history: trueFalse(
      'Konstytucja 3 maja była pierwszą nowoczesną ustawą zasadniczą w Europie.',
      ['Prawda', 'Fałsz'],
      'true',
      2,
      'true',
    ),
    driving: mcq(
      'Zbliżasz się do przejścia dla pieszych, na którym czeka osoba. Co robisz?',
      options(MCQ_DRIVING, [
        'Zwalniam i ustępuję pierwszeństwa',
        'Trąbię, żeby ostrzec pieszego',
        'Przyspieszam, żeby zdążyć przed zmianą świateł',
        'Omijam przejście lewą stroną jezdni',
      ]),
      'yield',
      3,
      'yield',
    ),
    language: open('Uzupełnij zdanie: „She ___ to school every day.”', 4),
    tech: mcq(
      'Która klauzula SQL zawęża wynik zapytania do pasujących wierszy?',
      options(MCQ_TECH, ['WHERE', 'ORDER BY', 'GROUP BY', 'JOIN']),
      'where',
      5,
      'where',
    ),
  },
  en: {
    biology: mcq(
      'Which organelle produces most of the ATP in a eukaryotic cell?',
      options(MCQ_BIOLOGY, ['Mitochondrion', 'Golgi apparatus', 'Ribosome', 'Lysosome']),
      'mitochondrium',
      1,
      'mitochondrium',
    ),
    history: trueFalse(
      'The Constitution of 3 May 1791 was the first modern constitution in Europe.',
      ['True', 'False'],
      'true',
      2,
      'true',
    ),
    driving: mcq(
      'You approach a zebra crossing where a pedestrian is waiting. What do you do?',
      options(MCQ_DRIVING, [
        'Slow down and give way',
        'Sound the horn to warn them',
        'Speed up to beat the lights',
        'Pass on the left-hand side',
      ]),
      'yield',
      3,
      'yield',
    ),
    language: open('Complete the sentence: “She ___ to school every day.”', 4),
    tech: mcq(
      'Which SQL clause narrows a query to matching rows?',
      options(MCQ_TECH, ['WHERE', 'ORDER BY', 'GROUP BY', 'JOIN']),
      'where',
      5,
      'where',
    ),
  },
};
