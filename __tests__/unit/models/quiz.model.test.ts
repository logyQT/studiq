import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { GenerateQuizSchema } from '@studiq/server/models/quiz.model';
import { describe, expect, it } from 'vitest';

describe('GenerateQuizSchema', () => {
  it('passes with valid input', () => {
    const result = GenerateQuizSchema.safeParse({
      questionTypes: ['mcq'],
      questionCount: 10,
    });
    expect(result.success).toBe(true);
  });

  it('passes with optional fields', () => {
    const result = GenerateQuizSchema.safeParse({
      bankId: '550e8400-e29b-41d4-a716-446655440000',
      topicIds: ['550e8400-e29b-41d4-a716-446655440001'],
      questionTypes: ['mcq', 'true_false'],
      questionCount: 25,
    });
    expect(result.success).toBe(true);
  });

  it('fails when questionTypes is empty', () => {
    const result = GenerateQuizSchema.safeParse({
      questionTypes: [],
      questionCount: 10,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });

  it('fails when questionCount is less than 1', () => {
    const result = GenerateQuizSchema.safeParse({
      questionTypes: ['mcq'],
      questionCount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('fails when questionCount is greater than 50', () => {
    const result = GenerateQuizSchema.safeParse({
      questionTypes: ['mcq'],
      questionCount: 51,
    });
    expect(result.success).toBe(false);
  });

  it('fails when questionTypes has invalid type', () => {
    const result = GenerateQuizSchema.safeParse({
      questionTypes: ['essay'],
      questionCount: 10,
    });
    expect(result.success).toBe(false);
  });
});
