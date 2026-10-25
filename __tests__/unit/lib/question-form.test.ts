import { describe, expect, it } from 'vitest';
import { normalizeTrueFalseAnswers, validateQuestionForm } from '@/lib/question-form';

function mcq(...contents: string[]) {
  return contents.map((content) => ({ content }));
}

const plLabels = { trueLabel: 'Prawda', falseLabel: 'Fałsz' };

describe('validateQuestionForm (#155)', () => {
  it('requires content', () => {
    expect(validateQuestionForm({ type: 'open', content: '', answers: [] })).toBe(
      'content_required',
    );
    expect(validateQuestionForm({ type: 'mcq', content: '   ', answers: mcq('a', 'b') })).toBe(
      'content_required',
    );
  });

  it('accepts an open question without answers', () => {
    expect(validateQuestionForm({ type: 'open', content: 'Wyjaśnij', answers: [] })).toBeNull();
  });

  it('requires at least two options for mcq', () => {
    expect(validateQuestionForm({ type: 'mcq', content: 'Pytanie', answers: mcq() })).toBe(
      'mcq_min_answers',
    );
    expect(validateQuestionForm({ type: 'mcq', content: 'Pytanie', answers: mcq('a') })).toBe(
      'mcq_min_answers',
    );
    expect(
      validateQuestionForm({ type: 'mcq', content: 'Pytanie', answers: mcq('a', 'b') }),
    ).toBeNull();
  });

  it('requires both options for true_false', () => {
    expect(validateQuestionForm({ type: 'true_false', content: 'Pytanie', answers: mcq() })).toBe(
      'answers_required',
    );
    expect(
      validateQuestionForm({ type: 'true_false', content: 'Pytanie', answers: mcq('Prawda') }),
    ).toBe('answers_required');
    expect(
      validateQuestionForm({
        type: 'true_false',
        content: 'Pytanie',
        answers: mcq('Prawda', 'Fałsz'),
      }),
    ).toBeNull();
  });

  it('ignores whitespace-only options when counting', () => {
    expect(
      validateQuestionForm({ type: 'mcq', content: 'Pytanie', answers: mcq('a', '   ') }),
    ).toBe('mcq_min_answers');
    expect(
      validateQuestionForm({ type: 'true_false', content: 'Pytanie', answers: mcq('  ') }),
    ).toBe('answers_required');
    expect(
      validateQuestionForm({ type: 'true_false', content: 'Pytanie', answers: mcq('Prawda', ' ') }),
    ).toBe('answers_required');
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
