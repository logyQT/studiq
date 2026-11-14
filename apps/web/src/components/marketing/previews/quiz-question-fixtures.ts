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
): QuizQuestionViewQuestion {
  return {
    stem,
    options: choices,
    selectedOptionId,
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
): QuizQuestionViewQuestion {
  return {
    stem,
    options: [
      { id: 'true', label: labels[0] },
      { id: 'false', label: labels[1] },
    ],
    selectedOptionId,
    textAnswer: '',
    position,
    total: 5,
    type: 'true_false',
  };
}

/** An open-answer card — used by tests, not by the marketing sequence. */
function open(stem: string, position: number): QuizQuestionViewQuestion {
  return {
    stem,
    options: [],
    selectedOptionId: null,
    textAnswer: '',
    position,
    total: 5,
    type: 'open',
  };
}

export const QUIZ_QUESTION_FIXTURES: Record<
  QuizFixtureLocale,
  Record<QuizSubject, QuizQuestionViewQuestion>
> = {
  pl: {
    biology: mcq(
      'Które organellum wytwarza większość ATP w komórce eukariotycznej?',
      options(MCQ_BIOLOGY, ['Mitochondrium', 'Aparat Golgiego', 'Rybosom', 'Lizosom']),
      'mitochondrium',
      1,
    ),
    history: trueFalse(
      'Konstytucja 3 maja była pierwszą nowoczesną ustawą zasadniczą w Europie.',
      ['Prawda', 'Fałsz'],
      'true',
      2,
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
    ),
    language: open('Uzupełnij zdanie: „She ___ to school every day.”', 4),
    tech: mcq(
      'Która klauzula SQL zawęża wynik zapytania do pasujących wierszy?',
      options(MCQ_TECH, ['WHERE', 'ORDER BY', 'GROUP BY', 'JOIN']),
      'where',
      5,
    ),
  },
  en: {
    biology: mcq(
      'Which organelle produces most of the ATP in a eukaryotic cell?',
      options(MCQ_BIOLOGY, ['Mitochondrion', 'Golgi apparatus', 'Ribosome', 'Lysosome']),
      'mitochondrium',
      1,
    ),
    history: trueFalse(
      'The Constitution of 3 May 1791 was the first modern constitution in Europe.',
      ['True', 'False'],
      'true',
      2,
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
    ),
    language: open('Complete the sentence: “She ___ to school every day.”', 4),
    tech: mcq(
      'Which SQL clause narrows a query to matching rows?',
      options(MCQ_TECH, ['WHERE', 'ORDER BY', 'GROUP BY', 'JOIN']),
      'where',
      5,
    ),
  },
};
