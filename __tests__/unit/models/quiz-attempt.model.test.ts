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

  it('rejects a bare entry that carries no answer value (#1161)', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [{ questionId: '550e8400-e29b-41d4-a716-446655440001' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['answers', 0]);
    }
  });

  it('accepts an explicitly skipped entry (#1161)', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [{ questionId: '550e8400-e29b-41d4-a716-446655440001', skipped: true }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects skipped: false, which is not an answer value (#1161)', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [
        {
          questionId: '550e8400-e29b-41d4-a716-446655440001',
          selectedAnswerId: '550e8400-e29b-41d4-a716-446655440002',
          skipped: false,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['answers', 0, 'skipped']);
    }
  });

  it('rejects an entry that sends both an option and free text (#1161)', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [
        {
          questionId: '550e8400-e29b-41d4-a716-446655440001',
          selectedAnswerId: '550e8400-e29b-41d4-a716-446655440002',
          textAnswer: 'Wisła',
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['answers', 0, 'textAnswer']);
    }
  });

  it('rejects free text combined with skipped (#1161)', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [
        {
          questionId: '550e8400-e29b-41d4-a716-446655440001',
          textAnswer: 'Wisła',
          skipped: true,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['answers', 0]);
    }
  });

  it('rejects an option combined with skipped (#1161)', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [
        {
          questionId: '550e8400-e29b-41d4-a716-446655440001',
          selectedAnswerId: '550e8400-e29b-41d4-a716-446655440002',
          skipped: true,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['answers', 0]);
    }
  });

  it('rejects an empty textAnswer — a cleared answer is skipped, not "" (#1161)', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [{ questionId: '550e8400-e29b-41d4-a716-446655440001', textAnswer: '' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['answers', 0, 'textAnswer']);
    }
  });

  it('rejects a whitespace-only textAnswer (#1161)', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [{ questionId: '550e8400-e29b-41d4-a716-446655440001', textAnswer: '   ' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['answers', 0, 'textAnswer']);
    }
  });

  it('fails when attemptId is not a valid UUID', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: 'not-a-uuid',
      answers: [{ questionId: '550e8400-e29b-41d4-a716-446655440001', skipped: true }],
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

  it('accepts 101 distinct answers so a large assignment can still submit (#1065)', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: Array.from({ length: 101 }, (_, i) => ({
        questionId: `${String(i).padStart(8, '0')}-e29b-41d4-a716-446655440001`,
        skipped: true,
      })),
    });
    expect(result.success).toBe(true);
  });

  it('accepts a sheet larger than the old 500-entry cap — the attempt decides (#1065)', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: Array.from({ length: 501 }, (_, i) => ({
        questionId: `${String(i).padStart(8, '0')}-e29b-41d4-a716-446655440001`,
        skipped: true,
      })),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.answers).toHaveLength(501);
  });

  it('rejects the same questionId twice and points at the repeated entry (#1065)', () => {
    const questionId = '550e8400-e29b-41d4-a716-446655440001';
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [
        { questionId, selectedAnswerId: '550e8400-e29b-41d4-a716-446655440002' },
        { questionId, selectedAnswerId: '550e8400-e29b-41d4-a716-446655440003' },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['answers', 1, 'questionId']);
    }
  });

  it('fails when questionId is not a valid UUID', () => {
    const result = SubmitQuizAttemptSchema.safeParse({
      attemptId: '550e8400-e29b-41d4-a716-446655440000',
      answers: [{ questionId: 'not-a-uuid', skipped: true }],
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
      expect(result.data.answers[0]?.textAnswer).toBe(
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
      expect(result.data.answers[0]?.textAnswer).toBe('answer');
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

  it('accepts the same explicit skip entry as submit (#1161)', () => {
    const result = SaveQuizAnswersSchema.safeParse({
      attemptId,
      answers: [{ questionId, skipped: true }],
    });

    expect(result.success).toBe(true);
  });

  it('rejects a bare entry (#1161)', () => {
    const result = SaveQuizAnswersSchema.safeParse({ attemptId, answers: [{ questionId }] });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['answers', 0]);
    }
  });

  it('rejects an empty textAnswer (#1161)', () => {
    const result = SaveQuizAnswersSchema.safeParse({
      attemptId,
      answers: [{ questionId, textAnswer: '  ' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['answers', 0, 'textAnswer']);
    }
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
    if (result.success) expect(result.data.answers[0]?.textAnswer).toBe('Wisła');
  });

  it('rejects textAnswer longer than 10 000 characters', () => {
    const result = SaveQuizAnswersSchema.safeParse({
      attemptId,
      answers: [{ questionId, textAnswer: 'a'.repeat(10001) }],
    });

    expect(result.success).toBe(false);
  });

  it('accepts a sheet larger than the old 500-entry cap — the attempt decides (#1065)', () => {
    const result = SaveQuizAnswersSchema.safeParse({
      attemptId,
      answers: Array.from({ length: 501 }, (_, i) => ({
        questionId: `${String(i).padStart(8, '0')}-e29b-41d4-a716-446655440001`,
        skipped: true,
      })),
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.answers).toHaveLength(501);
  });

  it('rejects a malformed attemptId', () => {
    const result = SaveQuizAnswersSchema.safeParse({ attemptId: 'nope', answers: [] });

    expect(result.success).toBe(false);
  });
});
