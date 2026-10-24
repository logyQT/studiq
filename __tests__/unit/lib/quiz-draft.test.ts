import { describe, expect, it } from 'vitest';
import { seedQuizAnswers, toSaveAnswersPayload } from '@/lib/quiz-draft';

const questions = [
  { id: 'q-mcq', type: 'mcq' },
  { id: 'q-open', type: 'open' },
  { id: 'q-unanswered', type: 'true_false' },
];

describe('seedQuizAnswers (#349)', () => {
  it('restores an option id for a choice question and text for an open one', () => {
    const seeded = seedQuizAnswers(questions, {
      'q-mcq': { selected_answer_id: 'ans-1', text_answer: null },
      'q-open': { selected_answer_id: null, text_answer: 'Wisła' },
    });

    expect(seeded).toEqual({ 'q-mcq': 'ans-1', 'q-open': 'Wisła' });
  });

  it('never pairs open text with an option id', () => {
    const seeded = seedQuizAnswers([{ id: 'q-open', type: 'open' }], {
      'q-open': { selected_answer_id: 'ans-1', text_answer: null },
    });

    expect(seeded).toEqual({});
  });

  it('skips unanswered questions', () => {
    const seeded = seedQuizAnswers(questions, {
      'q-mcq': { selected_answer_id: null, text_answer: null },
      'q-unanswered': { selected_answer_id: null, text_answer: '   ' },
    });

    expect(seeded).toEqual({});
  });

  it('ignores answers for questions outside the attempt', () => {
    const seeded = seedQuizAnswers(questions, {
      'q-stranger': { selected_answer_id: 'ans-9', text_answer: null },
    });

    expect(seeded).toEqual({});
  });

  it('returns an empty state when the attempt has no saved answers', () => {
    expect(seedQuizAnswers(questions, undefined)).toEqual({});
  });
});

describe('toSaveAnswersPayload (#349)', () => {
  it('sends option ids for choice questions and text for open ones', () => {
    expect(toSaveAnswersPayload(questions, { 'q-mcq': 'ans-1', 'q-open': 'Wisła' })).toEqual([
      { questionId: 'q-mcq', selectedAnswerId: 'ans-1' },
      { questionId: 'q-open', textAnswer: 'Wisła' },
    ]);
  });

  it('trims values and drops empty answers', () => {
    expect(toSaveAnswersPayload(questions, { 'q-mcq': '  ans-1  ', 'q-open': '   ' })).toEqual([
      { questionId: 'q-mcq', selectedAnswerId: 'ans-1' },
    ]);
  });

  it('ignores ids that are not part of the attempt', () => {
    expect(toSaveAnswersPayload(questions, { 'q-stranger': 'ans-9' })).toEqual([]);
  });

  it('produces an empty list for freshly loaded state', () => {
    expect(toSaveAnswersPayload(questions, {})).toEqual([]);
  });

  it('round-trips what seedQuizAnswers restored', () => {
    const answers = {
      'q-mcq': { selected_answer_id: 'ans-1', text_answer: null },
      'q-open': { selected_answer_id: null, text_answer: 'Wisła' },
    };

    expect(toSaveAnswersPayload(questions, seedQuizAnswers(questions, answers))).toEqual([
      { questionId: 'q-mcq', selectedAnswerId: 'ans-1' },
      { questionId: 'q-open', textAnswer: 'Wisła' },
    ]);
  });
});
