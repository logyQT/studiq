import { describe, it, expect } from 'vitest';
import { GenerateQuizSchema } from '@/server/models/quiz.model';
import { ValidationErrorCode } from '@/lib/validation-errors';

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
      subjectId: '550e8400-e29b-41d4-a716-446655440000',
      questionTypes: ['mcq', 'true_false'],
      difficulty: 'mixed',
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

  it('fails when difficulty is invalid', () => {
    const result = GenerateQuizSchema.safeParse({
      questionTypes: ['mcq'],
      difficulty: 'extreme',
      questionCount: 10,
    });
    expect(result.success).toBe(false);
  });

  it('fails when subjectId is not a valid UUID', () => {
    const result = GenerateQuizSchema.safeParse({
      subjectId: 'not-a-uuid',
      questionTypes: ['mcq'],
      questionCount: 10,
    });
    expect(result.success).toBe(false);
  });
});
