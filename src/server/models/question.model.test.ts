import { describe, it, expect } from 'vitest';
import { CreateQuestionSchema, UpdateQuestionSchema } from './question.model';
import { ValidationErrorCode } from '@/lib/validation-errors';

describe('CreateQuestionSchema', () => {
  it('passes with valid input', () => {
    const result = CreateQuestionSchema.safeParse({
      type: 'mcq',
      content: 'What is 2+2?',
      answers: [{ content: '4', isCorrect: true, orderIndex: 0 }],
    });
    expect(result.success).toBe(true);
  });

  it('passes with optional fields', () => {
    const result = CreateQuestionSchema.safeParse({
      subjectId: '550e8400-e29b-41d4-a716-446655440000',
      type: 'true_false',
      content: 'True or false?',
      explanation: 'The answer is true',
      difficulty: 'easy',
      answers: [{ content: 'True', isCorrect: true, orderIndex: 0 }],
    });
    expect(result.success).toBe(true);
  });

  it('fails when content is empty', () => {
    const result = CreateQuestionSchema.safeParse({
      type: 'mcq',
      content: '',
      answers: [{ content: '4', isCorrect: true }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });

  it('fails when answers is empty', () => {
    const result = CreateQuestionSchema.safeParse({
      type: 'mcq',
      content: 'Question',
      answers: [],
    });
    expect(result.success).toBe(false);
  });

  it('fails when answer content is empty', () => {
    const result = CreateQuestionSchema.safeParse({
      type: 'mcq',
      content: 'Question',
      answers: [{ content: '', isCorrect: true }],
    });
    expect(result.success).toBe(false);
  });

  it('fails when type is invalid', () => {
    const result = CreateQuestionSchema.safeParse({
      type: 'invalid',
      content: 'Question',
      answers: [{ content: 'Answer', isCorrect: true }],
    });
    expect(result.success).toBe(false);
  });

  it('fails when difficulty is invalid', () => {
    const result = CreateQuestionSchema.safeParse({
      type: 'mcq',
      content: 'Question',
      difficulty: 'extreme',
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
        { id: '550e8400-e29b-41d4-a716-446655440000', content: 'Updated', isCorrect: false, orderIndex: 1 },
      ],
    });
    expect(result.success).toBe(true);
  });
});
