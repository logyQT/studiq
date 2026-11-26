import type { ProblematicQuestionStats } from '@studiq/server/models/stats.model';

/**
 * Preview data only — never a seed, never a fetch.
 *
 * One seminar group's last test, from the biology lecture the page's other
 * surfaces come from. Every rate is below one half, because that is the card's
 * own threshold; a fixture above it would be a row the component promises never
 * to show. Answer counts sit above the card's three-answer floor for the same
 * reason.
 */
export type ProblemQuestionsLocale = 'pl' | 'en';

/** No such bank: the preview renders its rows without links. */
const PREVIEW_BANK_ID = 'preview';

const RATES = [
  { id: 'atp', correctRate: 0.41, totalAnswers: 12 },
  { id: 'division', correctRate: 0.33, totalAnswers: 9 },
  { id: 'glycolysis', correctRate: 0.29, totalAnswers: 7 },
] as const;

const CONTENT: Record<ProblemQuestionsLocale, Record<(typeof RATES)[number]['id'], string>> = {
  pl: {
    atp: 'Gdzie w komórce powstaje większość ATP?',
    division: 'Czym różni się mitoza od mejozy?',
    glycolysis: 'Co powstaje w wyniku glikolizy?',
  },
  en: {
    atp: 'Where in the cell is most ATP produced?',
    division: 'How does mitosis differ from meiosis?',
    glycolysis: 'What is produced by glycolysis?',
  },
};

export const PROBLEM_QUESTION_FIXTURES: Record<ProblemQuestionsLocale, ProblematicQuestionStats[]> =
  {
    pl: RATES.map(({ id, correctRate, totalAnswers }) => ({
      id,
      content: CONTENT.pl[id],
      type: 'mcq',
      bankId: PREVIEW_BANK_ID,
      correctRate,
      totalAnswers,
    })),
    en: RATES.map(({ id, correctRate, totalAnswers }) => ({
      id,
      content: CONTENT.en[id],
      type: 'mcq',
      bankId: PREVIEW_BANK_ID,
      correctRate,
      totalAnswers,
    })),
  };
