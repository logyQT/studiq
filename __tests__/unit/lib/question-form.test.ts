import { describe, expect, it } from 'vitest';
import { validateQuestionForm } from '@/lib/question-form';

function mcq(...contents: string[]) {
  return contents.map((content) => ({ content }));
}

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

  it('requires at least one option for true_false', () => {
    expect(validateQuestionForm({ type: 'true_false', content: 'Pytanie', answers: mcq() })).toBe(
      'answers_required',
    );
    expect(
      validateQuestionForm({ type: 'true_false', content: 'Pytanie', answers: mcq('Prawda') }),
    ).toBeNull();
  });

  it('ignores whitespace-only options when counting', () => {
    expect(
      validateQuestionForm({ type: 'mcq', content: 'Pytanie', answers: mcq('a', '   ') }),
    ).toBe('mcq_min_answers');
    expect(
      validateQuestionForm({ type: 'true_false', content: 'Pytanie', answers: mcq('  ') }),
    ).toBe('answers_required');
  });
});
