import type { QuizQuestionViewQuestion } from '@/components/quiz/quiz-question-view';

/**
 * Three Polish questions, one per card shape the taking page renders: a
 * multiple-choice biology question, a true/false history question and an open
 * English-language question. Preview data only — never a seed, never a fetch.
 *
 * Keyed by subject so a preview names the subject it shows instead of an index.
 */
export const QUIZ_QUESTION_FIXTURES = {
  biology: {
    stem: 'Które organellum wytwarza większość ATP w komórce eukariotycznej?',
    options: [
      { id: 'mitochondrium', label: 'Mitochondrium' },
      { id: 'aparat-golgiego', label: 'Aparat Golgiego' },
      { id: 'rybosom', label: 'Rybosom' },
      { id: 'lizosom', label: 'Lizosom' },
    ],
    selectedOptionId: 'mitochondrium',
    textAnswer: '',
    position: 2,
    total: 5,
    type: 'mcq',
  },
  history: {
    stem: 'Konstytucja 3 maja była pierwszą nowoczesną ustawą zasadniczą w Europie.',
    options: [
      { id: 'prawda', label: 'Prawda' },
      { id: 'falsz', label: 'Fałsz' },
    ],
    selectedOptionId: 'prawda',
    textAnswer: '',
    position: 5,
    total: 6,
    type: 'true_false',
  },
  language: {
    stem: 'Uzupełnij zdanie: „She ___ to school every day.”',
    options: [],
    selectedOptionId: null,
    textAnswer: '',
    position: 3,
    total: 7,
    type: 'open',
  },
} satisfies Record<string, QuizQuestionViewQuestion>;
