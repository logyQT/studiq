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

describe('toSaveAnswersPayload (#349, #1161)', () => {
  it('sends option ids for choice questions, text for open ones, and a skip for the rest', () => {
    expect(toSaveAnswersPayload(questions, { 'q-mcq': 'ans-1', 'q-open': 'Wisła' })).toEqual([
      { questionId: 'q-mcq', selectedAnswerId: 'ans-1' },
      { questionId: 'q-open', textAnswer: 'Wisła' },
      { questionId: 'q-unanswered', skipped: true },
    ]);
  });

  it('trims values and marks whitespace-only answers skipped', () => {
    expect(toSaveAnswersPayload(questions, { 'q-mcq': '  ans-1  ', 'q-open': '   ' })).toEqual([
      { questionId: 'q-mcq', selectedAnswerId: 'ans-1' },
      { questionId: 'q-open', skipped: true },
      { questionId: 'q-unanswered', skipped: true },
    ]);
  });

  it('ignores ids that are not part of the attempt', () => {
    expect(toSaveAnswersPayload(questions, { 'q-stranger': 'ans-9' })).toEqual([
      { questionId: 'q-mcq', skipped: true },
      { questionId: 'q-open', skipped: true },
      { questionId: 'q-unanswered', skipped: true },
    ]);
  });

  it('produces a skip for every question in freshly loaded state', () => {
    expect(toSaveAnswersPayload(questions, {})).toEqual([
      { questionId: 'q-mcq', skipped: true },
      { questionId: 'q-open', skipped: true },
      { questionId: 'q-unanswered', skipped: true },
    ]);
  });

  it('emits one entry per question in question order for a mixed answer set', () => {
    const mixed = [
      { id: 'q-a', type: 'mcq' },
      { id: 'q-b', type: 'open' },
      { id: 'q-c', type: 'true_false' },
      { id: 'q-d', type: 'open' },
    ];

    // Insertion order deliberately disagrees with question order.
    const answers = { 'q-c': 'opt-c', 'q-b': 'Wisła' };

    expect(toSaveAnswersPayload(mixed, answers)).toEqual([
      { questionId: 'q-a', skipped: true },
      { questionId: 'q-b', textAnswer: 'Wisła' },
      { questionId: 'q-c', selectedAnswerId: 'opt-c' },
      { questionId: 'q-d', skipped: true },
    ]);
  });

  it('replaces a stored answer with a skip once the student clears it', () => {
    const stored = toSaveAnswersPayload(questions, { 'q-mcq': 'ans-1' });
    const cleared = toSaveAnswersPayload(questions, { 'q-mcq': '' });

    expect(stored).toContainEqual({ questionId: 'q-mcq', selectedAnswerId: 'ans-1' });
    expect(cleared).toContainEqual({ questionId: 'q-mcq', skipped: true });
  });

  it('sends a UUID-shaped open answer as text, never as an option id (#320)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';

    expect(toSaveAnswersPayload([{ id: 'q-open', type: 'open' }], { 'q-open': uuid })).toEqual([
      { questionId: 'q-open', textAnswer: uuid },
    ]);
  });

  it('round-trips what seedQuizAnswers restored', () => {
    const answers = {
      'q-mcq': { selected_answer_id: 'ans-1', text_answer: null },
      'q-open': { selected_answer_id: null, text_answer: 'Wisła' },
    };

    expect(toSaveAnswersPayload(questions, seedQuizAnswers(questions, answers))).toEqual([
      { questionId: 'q-mcq', selectedAnswerId: 'ans-1' },
      { questionId: 'q-open', textAnswer: 'Wisła' },
      { questionId: 'q-unanswered', skipped: true },
    ]);
  });
});
