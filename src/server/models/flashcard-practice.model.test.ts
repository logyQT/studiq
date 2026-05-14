import { describe, it, expect } from 'vitest';
import { LogPracticeSchema } from './flashcard-practice.model';

describe('LogPracticeSchema', () => {
  it('passes with valid input', () => {
    const result = LogPracticeSchema.safeParse({
      flashcardId: '550e8400-e29b-41d4-a716-446655440000',
      wasCorrect: true,
    });
    expect(result.success).toBe(true);
  });

  it('fails when flashcardId is not a valid UUID', () => {
    const result = LogPracticeSchema.safeParse({
      flashcardId: 'not-a-uuid',
      wasCorrect: true,
    });
    expect(result.success).toBe(false);
  });

  it('fails when wasCorrect is missing', () => {
    const result = LogPracticeSchema.safeParse({
      flashcardId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(false);
  });

  it('fails when flashcardId is missing', () => {
    const result = LogPracticeSchema.safeParse({
      wasCorrect: true,
    });
    expect(result.success).toBe(false);
  });
});
