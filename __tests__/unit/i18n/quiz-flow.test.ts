import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

// #322 / #328: the student quiz flow (new quiz form, taking page) was hardcoded English in the
// Polish UI. The strings now come from messages, with the placeholders the pages pass.

const TAKING_KEYS = [
  'loading',
  'load_failed',
  'save_failed',
  'submit_failed',
  'question_of',
  'previous',
  'next',
  'submit',
  'answer_placeholder',
  'type_mcq',
  'type_true_false',
  'type_open',
] as const;

const GENERATE_KEYS = [
  'generate_failed',
  'no_questions_found',
  'not_enough_questions',
  'select_question_type',
  'type_mcq',
  'type_true_false',
  'type_open',
] as const;

describe.each([
  ['pl', pl],
  ['en', en],
])('student quiz flow messages (%s)', (_locale, messages) => {
  it('translates every key of the quiz taking page', () => {
    const taking = messages.AppQuizTakingPage as Record<string, string>;

    for (const key of TAKING_KEYS) {
      expect(taking[key], `AppQuizTakingPage.${key}`).toBeTypeOf('string');
      expect(taking[key]).not.toHaveLength(0);
    }
    expect(taking.question_of).toContain('{current}');
    expect(taking.question_of).toContain('{total}');
  });

  it('translates the type labels and the errors of the new quiz form', () => {
    const quiz = messages.AppQuizPage as Record<string, string>;

    for (const key of GENERATE_KEYS) {
      expect(quiz[key], `AppQuizPage.${key}`).toBeTypeOf('string');
      expect(quiz[key]).not.toHaveLength(0);
    }
  });
});

describe('quiz flow components', () => {
  const read = (p: string) => fs.readFileSync(p, 'utf8');
  const taking = read('apps/web/src/app/(frontend)/app/study/session/quiz/[attemptId]/page.tsx');
  const form = read('apps/web/src/components/study/quiz-content.tsx');

  it('keeps no English UI literals on the taking page', () => {
    for (const literal of [
      'Previous',
      'Submit Quiz',
      'Type your answer',
      'Failed to',
      'Loading...',
    ]) {
      expect(taking, literal).not.toContain(literal);
    }
    expect(taking).not.toMatch(/Question \{currentQ/);
  });

  it('keeps no English UI literals in the new quiz form', () => {
    for (const literal of [
      "'MCQ'",
      "'True/False'",
      "'Failed to generate quiz'",
      'No questions found',
    ]) {
      expect(form, literal).not.toContain(literal);
    }
  });
});
