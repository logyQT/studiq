import { describe, expect, it } from 'vitest';
import { SubmitQuizAttemptSchema } from '@/server/models/quiz-attempt.model';

describe('SubmitQuizAttemptSchema', () => {
  it('passes with valid input', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [
        {
          questionId: '550e8400-e29b-41d4-a716-446655440001',
          selectedAnswerId: '550e8400-e29b-41d4-a716-446655440002',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('passes with optional selectedAnswerId', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [{ questionId: '550e8400-e29b-41d4-a716-446655440001' }],
    });
    expect(result.success).toBe(true);
  });

  it('fails when attemptId is not a valid UUID', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: 'not-a-uuid',
      answers: [{ questionId: '550e8400-e29b-41d4-a716-446655440001' }],
    });
    expect(result.success).toBe(false);
  });

  it('passes when answers array is empty (no min constraint)', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [],
    });
    expect(result.success).toBe(true);
  });

  it('fails when questionId is not a valid UUID', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [{ questionId: 'not-a-uuid' }],
    });
    expect(result.success).toBe(false);
  });
});
