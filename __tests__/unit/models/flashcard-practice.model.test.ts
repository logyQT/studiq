import {
  BatchPracticeSchema,
  CompleteSessionSchema,
  LogPracticeSchema,
} from '@studiq/server/models/flashcard-practice.model';
import { describe, expect, it } from 'vitest';

describe('LogPracticeSchema', () => {
  it('passes with valid input', () => {
    const result = LogPracticeSchema.safeParse({
      wasCorrect: true,
    });
    expect(result.success).toBe(true);
  });

  it('passes with all optional fields', () => {
    const result = LogPracticeSchema.safeParse({
      wasCorrect: false,
      responseTimeMs: 1500,
      confidenceLevel: 4,
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('fails when wasCorrect is missing', () => {
    const result = LogPracticeSchema.safeParse({
      responseTimeMs: 1000,
    });
    expect(result.success).toBe(false);
  });

  it('fails when confidenceLevel is out of range', () => {
    const result = LogPracticeSchema.safeParse({
      wasCorrect: true,
      confidenceLevel: 6,
    });
    expect(result.success).toBe(false);
  });

  it('fails when confidenceLevel is zero', () => {
    const result = LogPracticeSchema.safeParse({
      wasCorrect: true,
      confidenceLevel: 0,
    });
    expect(result.success).toBe(false);
  });

  it('fails when responseTimeMs is negative', () => {
    const result = LogPracticeSchema.safeParse({
      wasCorrect: true,
      responseTimeMs: -100,
    });
    expect(result.success).toBe(false);
  });

  it('fails when sessionId is not a valid UUID', () => {
    const result = LogPracticeSchema.safeParse({
      wasCorrect: true,
      sessionId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('defaults mode to "review" when omitted (#617)', () => {
    const result = LogPracticeSchema.safeParse({ wasCorrect: true });
    expect(result.success).toBe(true);
    expect(result.data?.mode).toBe('review');
  });

  it('accepts the cram mode (#617)', () => {
    const result = LogPracticeSchema.safeParse({ wasCorrect: true, mode: 'cram' });
    expect(result.success).toBe(true);
    expect(result.data?.mode).toBe('cram');
  });

  it('rejects an unknown mode (#617)', () => {
    const result = LogPracticeSchema.safeParse({ wasCorrect: true, mode: 'bogus' });
    expect(result.success).toBe(false);
  });
});

describe('BatchPracticeSchema', () => {
  const items = [{ flashcardId: '550e8400-e29b-41d4-a716-446655440000', wasCorrect: true }];

  it('defaults mode to "review" when omitted (#617)', () => {
    const result = BatchPracticeSchema.safeParse({ items });
    expect(result.success).toBe(true);
    expect(result.data?.mode).toBe('review');
  });

  it('accepts the cram mode (#617)', () => {
    const result = BatchPracticeSchema.safeParse({ items, mode: 'cram' });
    expect(result.success).toBe(true);
    expect(result.data?.mode).toBe('cram');
  });

  it('rejects an unknown mode (#617)', () => {
    const result = BatchPracticeSchema.safeParse({ items, mode: 'bogus' });
    expect(result.success).toBe(false);
  });
});

describe('CompleteSessionSchema durationMs', () => {
  const base = {
    sessionId: '00000000-0000-4000-8000-000000000001',
    startedAt: '2026-10-27T10:00:00.000Z',
    completedAt: '2026-10-27T10:10:00.000Z',
    cardsStudied: 5,
    cardsCorrect: 4,
    mode: 'review' as const,
  };

  it('accepts up to two hours', () => {
    expect(CompleteSessionSchema.safeParse({ ...base, durationMs: 7_200_000 }).success).toBe(true);
  });

  it('refuses an eight hour session: it cannot be stored', () => {
    expect(CompleteSessionSchema.safeParse({ ...base, durationMs: 28_800_000 }).success).toBe(
      false,
    );
  });
});
