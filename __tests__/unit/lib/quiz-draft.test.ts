import { describe, expect, it } from 'vitest';
import {
  seedQuizAnswers,
  seedQuizPhotos,
  toSaveAnswersPayload,
  unansweredIndexes,
} from '@/lib/quiz-draft';

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

describe('unansweredIndexes (#1353)', () => {
  const sheet = [
    { id: 'q-1', type: 'mcq' },
    { id: 'q-2', type: 'open' },
    { id: 'q-3', type: 'true_false' },
  ];

  it('is empty when every question has an answer', () => {
    expect(unansweredIndexes(sheet, { 'q-1': 'a', 'q-2': 'text', 'q-3': 'b' })).toEqual([]);
  });

  it('lists exactly the questions with no answer, by position', () => {
    expect(unansweredIndexes(sheet, { 'q-2': 'text' })).toEqual([0, 2]);
  });

  it('counts a text of whitespace as no answer', () => {
    expect(unansweredIndexes(sheet, { 'q-1': 'a', 'q-2': ' \n\t ', 'q-3': 'b' })).toEqual([1]);
  });

  it('counts an attached photo as an answer, but not an empty list', () => {
    const answers = { 'q-1': 'a', 'q-3': 'b' };

    expect(unansweredIndexes(sheet, answers, { 'q-2': ['photo'] })).toEqual([]);
    expect(unansweredIndexes(sheet, answers, { 'q-2': [] })).toEqual([1]);
  });
});

const nameOf = (position: number) => `photo ${position}`;

describe('seedQuizPhotos (#1544)', () => {
  const sheet = [
    { id: 'q-1', type: 'mcq' },
    { id: 'q-2', type: 'open' },
    { id: 'q-3', type: 'open' },
  ];

  it('restores the photos of an open question, numbered from 1', () => {
    expect(seedQuizPhotos(sheet, { 'q-2': ['u-1', 'u-2'] }, nameOf)).toEqual({
      'q-2': [
        { url: 'u-1', name: 'photo 1' },
        { url: 'u-2', name: 'photo 2' },
      ],
    });
  });

  it('ignores a choice question, an unknown question and an empty list', () => {
    const images = { 'q-1': ['u-1'], 'q-9': ['u-9'], 'q-3': [] };

    expect(seedQuizPhotos(sheet, images, nameOf)).toEqual({});
    expect(seedQuizPhotos(sheet, undefined, nameOf)).toEqual({});
  });

  it('makes a photo-only question count as answered after a resume', () => {
    const photos = seedQuizPhotos(sheet, { 'q-2': ['u-1'] }, nameOf);

    // The question with a saved photo is not listed; the one with nothing still is.
    expect(unansweredIndexes(sheet, {}, photos)).toEqual([0, 2]);
  });
});
