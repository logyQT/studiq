import { SubmitQuizAttemptSchema } from '@studiq/server/models/quiz-attempt.model';
import { describe, expect, it } from 'vitest';

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

  it('rejects free text sent as selectedAnswerId (#176)', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [
        {
          questionId: '550e8400-e29b-41d4-a716-446655440001',
          selectedAnswerId: 'Rozbiory, słaba władza centralna, liberum veto.',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a free-text answer in textAnswer', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [
        {
          questionId: '550e8400-e29b-41d4-a716-446655440001',
          textAnswer: 'Rozbiory, słaba władza centralna, liberum veto.',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.answers[0].textAnswer).toBe(
        'Rozbiory, słaba władza centralna, liberum veto.',
      );
    }
  });

  it('trims textAnswer', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [{ questionId: '550e8400-e29b-41d4-a716-446655440001', textAnswer: '  answer  ' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.answers[0].textAnswer).toBe('answer');
    }
  });

  it('rejects textAnswer longer than 10 000 characters', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [
        { questionId: '550e8400-e29b-41d4-a716-446655440001', textAnswer: 'a'.repeat(10001) },
      ],
    });
    expect(result.success).toBe(false);
  });
});
