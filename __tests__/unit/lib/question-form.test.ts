import { describe, expect, it } from 'vitest';
import {
  fieldErrorsFromApiError,
  normalizeTrueFalseAnswers,
  validateQuestionForm,
} from '@/lib/question-form';
import { ApiError } from '@/lib/api';

function mcq(...contents: string[]) {
  return contents.map((content) => ({ content }));
}

const plLabels = { trueLabel: 'Prawda', falseLabel: 'Fałsz' };

const TEACHING =
  'Cztery jest poprawne, bo dodanie dwóch jedynek daje dokładnie cztery, a nie pięć — to pierwszy krok do dodawania.';

describe('validateQuestionForm (#155)', () => {
  it('requires content', () => {
    expect(
      validateQuestionForm({ type: 'open', content: '', modelAnswer: 'x', answers: [] }),
    ).toEqual({ content: 'content_required' });
    expect(
      validateQuestionForm({
        type: 'mcq',
        content: '   ',
        explanation: TEACHING,
        answers: mcq('a', 'b'),
      }),
    ).toEqual({ content: 'content_required' });
  });

  it('accepts an open question without answers once it has a model answer', () => {
    expect(
      validateQuestionForm({
        type: 'open',
        content: 'Wyjaśnij',
        modelAnswer: 'Bo woda paruje i wraca jako opad.',
        answers: [],
      }),
    ).toBeNull();
  });

  it('requires at least two options for mcq', () => {
    expect(
      validateQuestionForm({
        type: 'mcq',
        content: 'Pytanie',
        explanation: TEACHING,
        answers: mcq(),
      }),
    ).toEqual({ answers: 'mcq_min_answers' });
    expect(
      validateQuestionForm({
        type: 'mcq',
        content: 'Pytanie',
        explanation: TEACHING,
        answers: mcq('a'),
      }),
    ).toEqual({ answers: 'mcq_min_answers' });
    expect(
      validateQuestionForm({
        type: 'mcq',
        content: 'Pytanie',
        explanation: TEACHING,
        answers: mcq('a', 'b'),
      }),
    ).toBeNull();
  });

  it('requires both options for true_false', () => {
    expect(
      validateQuestionForm({
        type: 'true_false',
        content: 'Pytanie',
        explanation: TEACHING,
        answers: mcq(),
      }),
    ).toEqual({ answers: 'answers_required' });
    expect(
      validateQuestionForm({
        type: 'true_false',
        content: 'Pytanie',
        explanation: TEACHING,
        answers: mcq('Prawda'),
      }),
    ).toEqual({ answers: 'answers_required' });
    expect(
      validateQuestionForm({
        type: 'true_false',
        content: 'Pytanie',
        explanation: TEACHING,
        answers: mcq('Prawda', 'Fałsz'),
      }),
    ).toBeNull();
  });

  it('ignores whitespace-only options when counting', () => {
    expect(
      validateQuestionForm({
        type: 'mcq',
        content: 'Pytanie',
        explanation: TEACHING,
        answers: mcq('a', '   '),
      }),
    ).toEqual({ answers: 'mcq_min_answers' });
    expect(
      validateQuestionForm({
        type: 'true_false',
        content: 'Pytanie',
        explanation: TEACHING,
        answers: mcq('  '),
      }),
    ).toEqual({ answers: 'answers_required' });
    expect(
      validateQuestionForm({
        type: 'true_false',
        content: 'Pytanie',
        explanation: TEACHING,
        answers: mcq('Prawda', ' '),
      }),
    ).toEqual({ answers: 'answers_required' });
  });

  it('reports the explanation and model-answer rules per field (R16/R17)', () => {
    expect(
      validateQuestionForm({ type: 'mcq', content: 'Pytanie', answers: mcq('a', 'b') }),
    ).toEqual({ explanation: 'explanation_required' });

    expect(
      validateQuestionForm({
        type: 'mcq',
        content: 'Pytanie',
        explanation: 'Za krótko.',
        answers: mcq('a', 'b'),
      }),
    ).toEqual({ explanation: 'explanation_too_short' });

    expect(
      validateQuestionForm({
        type: 'mcq',
        content: 'Pytanie',
        explanation:
          'Poprawna jest druga odpowiedź, bo cztery to wynik dodania dwóch jedynek, a nie pięciu, co widać na palcach.',
        answers: mcq('a', 'b'),
      }),
    ).toEqual({ explanation: 'explanation_names_option' });

    expect(
      validateQuestionForm({ type: 'open', content: 'Opisz obieg wody', answers: [] }),
    ).toEqual({ modelAnswer: 'model_answer_required' });
  });

  it('collects every field problem at once instead of stopping at the first', () => {
    expect(
      validateQuestionForm({ type: 'mcq', content: '', explanation: '', answers: mcq() }),
    ).toEqual({
      content: 'content_required',
      answers: 'mcq_min_answers',
      explanation: 'explanation_required',
    });
  });
});

describe('fieldErrorsFromApiError', () => {
  it('maps a 422 issue tree onto the form fields', () => {
    const error = new ApiError('UNPROCESSABLE_ENTITY', 422, {
      errors: [],
      properties: {
        explanation: { errors: ['VALIDATION_EXPLANATION_QUOTES_OPTION'] },
        modelAnswer: { errors: ['VALIDATION_MODEL_ANSWER_REQUIRED'] },
      },
    });

    expect(fieldErrorsFromApiError(error)).toEqual({
      explanation: 'explanation_quotes_option',
      modelAnswer: 'model_answer_required',
    });
  });

  it('answers null when the failure is not about a form field', () => {
    expect(fieldErrorsFromApiError(new ApiError('FORBIDDEN', 403))).toBeNull();
    expect(fieldErrorsFromApiError(new Error('boom'))).toBeNull();
  });
});

describe('normalizeTrueFalseAnswers (#154)', () => {
  it('seeds both locale labels with the first row correct when there are no rows', () => {
    expect(normalizeTrueFalseAnswers([], plLabels)).toEqual([
      { content: 'Prawda', isCorrect: true },
      { content: 'Fałsz', isCorrect: false },
    ]);
  });

  it('keeps edited wording and a second-row correct flag', () => {
    expect(
      normalizeTrueFalseAnswers(
        [
          { content: 'Tak', isCorrect: false },
          { content: 'Nie', isCorrect: true },
        ],
        plLabels,
      ),
    ).toEqual([
      { content: 'Tak', isCorrect: false },
      { content: 'Nie', isCorrect: true },
    ]);
  });

  it('keeps only the first row correct when both flags are set', () => {
    expect(
      normalizeTrueFalseAnswers(
        [
          { content: 'Prawda', isCorrect: true },
          { content: 'Fałsz', isCorrect: true },
        ],
        plLabels,
      ),
    ).toEqual([
      { content: 'Prawda', isCorrect: true },
      { content: 'Fałsz', isCorrect: false },
    ]);
  });

  it('marks the first row correct when none is flagged', () => {
    expect(
      normalizeTrueFalseAnswers(
        [
          { content: 'Prawda', isCorrect: false },
          { content: 'Fałsz', isCorrect: false },
        ],
        plLabels,
      ),
    ).toEqual([
      { content: 'Prawda', isCorrect: true },
      { content: 'Fałsz', isCorrect: false },
    ]);
  });

  it('replaces whitespace-only text with the locale label', () => {
    expect(
      normalizeTrueFalseAnswers(
        [
          { content: '   ', isCorrect: true },
          { content: '', isCorrect: false },
        ],
        plLabels,
      ),
    ).toEqual([
      { content: 'Prawda', isCorrect: true },
      { content: 'Fałsz', isCorrect: false },
    ]);
  });

  it('pads a legacy one-option question and trims extra rows', () => {
    expect(normalizeTrueFalseAnswers([{ content: 'Tak', isCorrect: true }], plLabels)).toEqual([
      { content: 'Tak', isCorrect: true },
      { content: 'Fałsz', isCorrect: false },
    ]);

    expect(
      normalizeTrueFalseAnswers(
        [
          { content: 'A', isCorrect: true },
          { content: 'B', isCorrect: false },
          { content: 'C', isCorrect: false },
        ],
        plLabels,
      ),
    ).toEqual([
      { content: 'A', isCorrect: true },
      { content: 'B', isCorrect: false },
    ]);
  });
});
