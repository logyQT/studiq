import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { CreateQuestionSchema, UpdateQuestionSchema } from '@studiq/server/models/question.model';
import { describe, expect, it } from 'vitest';

const VALID_BANK_ID = '00000000-0000-4000-8020-000000000001';
// R16/R17: a choice item's explanation is required and has to teach, an open item needs a model
// answer. These are teaching-length fixtures, not labels.
const TEACHING =
  'Cztery jest poprawne, bo dodanie dwóch jedynek daje dokładnie tyle, a nie więcej — to pierwszy krok do zrozumienia dodawania.';
const MODEL_ANSWER = 'Woda paruje, skrapla się w chmury i wraca na ziemię jako opad.';

describe('CreateQuestionSchema', () => {
  it('passes with valid input', () => {
    const result = CreateQuestionSchema.safeParse({
      bankId: VALID_BANK_ID,
      type: 'mcq',
      content: 'What is 2+2?',
      explanation: TEACHING,
      answers: [{ content: '4', isCorrect: true, orderIndex: 0 }],
    });
    expect(result.success).toBe(true);
  });

  it('passes with optional fields', () => {
    const result = CreateQuestionSchema.safeParse({
      bankId: VALID_BANK_ID,
      type: 'true_false',
      content: 'True or false?',
      explanation: TEACHING,
      difficulty: 'easy',
      answers: [{ content: 'True', isCorrect: true, orderIndex: 0 }],
    });
    expect(result.success).toBe(true);
  });

  it('fails when content is empty', () => {
    const result = CreateQuestionSchema.safeParse({
      bankId: VALID_BANK_ID,
      type: 'mcq',
      content: '',
      answers: [{ content: '4', isCorrect: true }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });

  it('fails when answers is empty for mcq', () => {
    const result = CreateQuestionSchema.safeParse({
      bankId: VALID_BANK_ID,
      type: 'mcq',
      content: 'Question',
      answers: [],
    });
    expect(result.success).toBe(false);
  });

  it('passes for open questions with an empty answers array', () => {
    const result = CreateQuestionSchema.safeParse({
      bankId: VALID_BANK_ID,
      type: 'open',
      content: 'Describe Newton\u2019s second law.',
      modelAnswer: MODEL_ANSWER,
      answers: [],
    });
    expect(result.success).toBe(true);
  });

  it('defaults answers to an empty array for open questions when omitted', () => {
    const result = CreateQuestionSchema.safeParse({
      bankId: VALID_BANK_ID,
      type: 'open',
      content: 'Describe Newton\u2019s second law.',
      modelAnswer: MODEL_ANSWER,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.answers).toEqual([]);
    }
  });

  it('fails when answers is omitted for mcq', () => {
    const result = CreateQuestionSchema.safeParse({
      bankId: VALID_BANK_ID,
      type: 'mcq',
      content: 'Question',
      explanation: TEACHING,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['answers']);
      expect(result.error.issues[0]?.message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });

  it('fails when answers is empty for true_false', () => {
    const result = CreateQuestionSchema.safeParse({
      bankId: VALID_BANK_ID,
      type: 'true_false',
      content: 'Question',
      answers: [],
    });
    expect(result.success).toBe(false);
  });

  it('fails when answer content is empty', () => {
    const result = CreateQuestionSchema.safeParse({
      bankId: VALID_BANK_ID,
      type: 'mcq',
      content: 'Question',
      answers: [{ content: '', isCorrect: true }],
    });
    expect(result.success).toBe(false);
  });

  it('fails when type is invalid', () => {
    const result = CreateQuestionSchema.safeParse({
      bankId: VALID_BANK_ID,
      type: 'invalid',
      content: 'Question',
      answers: [{ content: 'Answer', isCorrect: true }],
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateQuestionSchema', () => {
  it('passes with partial input', () => {
    const result = UpdateQuestionSchema.safeParse({ content: 'Updated content' });
    expect(result.success).toBe(true);
  });

  it('passes with empty object (all optional)', () => {
    const result = UpdateQuestionSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('fails when content is empty string', () => {
    const result = UpdateQuestionSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });

  it('passes with valid answers update', () => {
    const result = UpdateQuestionSchema.safeParse({
      answers: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          content: 'Updated',
          isCorrect: false,
          orderIndex: 1,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('passes when converting a question to open with an empty answers array', () => {
    const result = UpdateQuestionSchema.safeParse({ type: 'open', answers: [] });
    expect(result.success).toBe(true);
  });

  it('passes when clearing answers without specifying a type', () => {
    const result = UpdateQuestionSchema.safeParse({ answers: [] });
    expect(result.success).toBe(true);
  });

  it('fails when setting a non-open type with an empty answers array', () => {
    const result = UpdateQuestionSchema.safeParse({ type: 'mcq', answers: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['answers']);
      expect(result.error.issues[0]?.message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });
});

function mcq(explanation?: string) {
  return {
    bankId: VALID_BANK_ID,
    type: 'mcq' as const,
    content: 'What is 2+2?',
    ...(explanation === undefined ? {} : { explanation }),
    answers: [
      { content: '4', isCorrect: true },
      { content: '5', isCorrect: false },
    ],
  };
}

describe('CreateQuestionSchema: the explanation and model-answer rules (R16/R17)', () => {
  it('rejects a choice item with no explanation, pointing at the field', () => {
    const result = CreateQuestionSchema.safeParse(mcq());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.path).toEqual(['explanation']);
      expect(result.error.issues[0]?.message).toBe(ValidationErrorCode.EXPLANATION_REQUIRED);
    }
  });

  it('rejects an explanation below the teaching floor', () => {
    const result = CreateQuestionSchema.safeParse(mcq('Wisła jest najdłuższa.'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['explanation']);
      expect(result.error.issues[0]?.message).toBe(ValidationErrorCode.EXPLANATION_TOO_SHORT);
    }
  });

  it('accepts the 2 040-character cap and rejects one character more', () => {
    expect(CreateQuestionSchema.safeParse(mcq('a'.repeat(2040))).success).toBe(true);

    const tooLong = CreateQuestionSchema.safeParse(mcq('a'.repeat(2041)));
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues[0]?.path).toEqual(['explanation']);
      expect(tooLong.error.issues[0]?.message).toBe(ValidationErrorCode.TOO_LONG);
    }
  });

  it('rejects an explanation that hands over an option', () => {
    for (const [explanation, message] of [
      [
        `Odpowiedź B jest poprawna, ponieważ dodanie dwóch jedynek daje cztery, a nie pięć.`,
        ValidationErrorCode.EXPLANATION_NAMES_OPTION,
      ],
      [
        `Poprawna jest druga odpowiedź, bo dodanie dwóch jedynek daje cztery, a nie pięć.`,
        ValidationErrorCode.EXPLANATION_NAMES_OPTION,
      ],
      [
        `Odpowiedź 4 jest poprawna, ponieważ dodanie dwóch jedynek daje cztery, a nie pięć.`,
        ValidationErrorCode.EXPLANATION_NAMES_OPTION,
      ],
    ] as const) {
      const result = CreateQuestionSchema.safeParse(mcq(explanation));
      expect(result.success, explanation).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path, explanation).toEqual(['explanation']);
        expect(result.error.issues[0]?.message, explanation).toBe(message);
      }
    }
  });

  it('rejects an explanation that quotes a long option verbatim', () => {
    const result = CreateQuestionSchema.safeParse({
      bankId: VALID_BANK_ID,
      type: 'mcq',
      content: 'Które miasto jest stolicą Polski?',
      explanation:
        'Warszawa jest stolicą Polski od 1596 roku, więc wybór wynika z historii kraju i z tego, że stolica została przeniesiona z Krakowa.',
      answers: [
        { content: 'Warszawa jest stolicą Polski', isCorrect: true },
        { content: 'Kraków był stolicą do 1596 roku', isCorrect: false },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(ValidationErrorCode.EXPLANATION_QUOTES_OPTION);
    }
  });

  it('requires a model answer for an open item, pointing at the field', () => {
    const result = CreateQuestionSchema.safeParse({
      bankId: VALID_BANK_ID,
      type: 'open',
      content: 'Opisz obieg wody w przyrodzie.',
      answers: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['modelAnswer']);
      expect(result.error.issues[0]?.message).toBe(ValidationErrorCode.MODEL_ANSWER_REQUIRED);
    }
  });
});
