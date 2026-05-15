import { describe, it, expect } from 'vitest';
import { LogPracticeSchema } from './flashcard-practice.model';

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
});
