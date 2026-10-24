import {
  SaveQuizAnswersSchema,
  SubmitQuizAttemptSchema,
} from '@studiq/server/models/quiz-attempt.model';
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

describe('SaveQuizAnswersSchema (#349)', () => {
  const attemptId = '550e8400-e29b-41d4-a716-446655440000';
  const questionId = '550e8400-e29b-41d4-a716-446655440001';
  const optionId = '550e8400-e29b-41d4-a716-446655440002';

  it('accepts an mcq answer and an open answer', () => {
    const result = SaveQuizAnswersSchema.safeParse({
      attemptId,
      answers: [
        { questionId, selectedAnswerId: optionId },
        { questionId: '550e8400-e29b-41d4-a716-446655440003', textAnswer: 'Wisła' },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts an empty answer list (clears the draft)', () => {
    const result = SaveQuizAnswersSchema.safeParse({ attemptId, answers: [] });

    expect(result.success).toBe(true);
  });

  it('rejects a malformed questionId', () => {
    const result = SaveQuizAnswersSchema.safeParse({
      attemptId,
      answers: [{ questionId: 'not-a-uuid' }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects free text sent as selectedAnswerId', () => {
    const result = SaveQuizAnswersSchema.safeParse({
      attemptId,
      answers: [{ questionId, selectedAnswerId: 'Wisła' }],
    });

    expect(result.success).toBe(false);
  });

  it('trims textAnswer', () => {
    const result = SaveQuizAnswersSchema.safeParse({
      attemptId,
      answers: [{ questionId, textAnswer: '  Wisła  ' }],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.answers[0].textAnswer).toBe('Wisła');
  });

  it('rejects textAnswer longer than 10 000 characters', () => {
    const result = SaveQuizAnswersSchema.safeParse({
      attemptId,
      answers: [{ questionId, textAnswer: 'a'.repeat(10001) }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects more than 100 answers', () => {
    const result = SaveQuizAnswersSchema.safeParse({
      attemptId,
      answers: Array.from({ length: 101 }, (_, i) => ({
        questionId: `${String(i).padStart(8, '0')}-e29b-41d4-a716-446655440001`,
      })),
    });

    expect(result.success).toBe(false);
  });

  it('rejects a malformed attemptId', () => {
    const result = SaveQuizAnswersSchema.safeParse({ attemptId: 'nope', answers: [] });

    expect(result.success).toBe(false);
  });
});
