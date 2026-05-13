import { describe, it, expect } from 'vitest';
import { CreateFlashcardSchema, BulkCreateFlashcardsSchema, UpdateFlashcardSchema } from './flashcard.model';
import { ValidationErrorCode } from '@/lib/validation-errors';

describe('CreateFlashcardSchema', () => {
  it('passes with valid input', () => {
    const result = CreateFlashcardSchema.safeParse({
      front: 'What is 2+2?',
      back: '4',
    });
    expect(result.success).toBe(true);
  });

  it('passes with optional topicIds', () => {
    const result = CreateFlashcardSchema.safeParse({
      topicIds: ['550e8400-e29b-41d4-a716-446655440000'],
      front: 'Front',
      back: 'Back',
    });
    expect(result.success).toBe(true);
  });

  it('fails when front is empty', () => {
    const result = CreateFlashcardSchema.safeParse({ front: '', back: 'Back' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });

  it('fails when back is empty', () => {
    const result = CreateFlashcardSchema.safeParse({ front: 'Front', back: '' });
    expect(result.success).toBe(false);
  });

  it('fails when topicIds contains invalid UUID', () => {
    const result = CreateFlashcardSchema.safeParse({
      topicIds: ['not-a-uuid'],
      front: 'Front',
      back: 'Back',
    });
    expect(result.success).toBe(false);
  });
});

describe('BulkCreateFlashcardsSchema', () => {
  it('passes with valid input', () => {
    const result = BulkCreateFlashcardsSchema.safeParse({
      cards: [{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }],
    });
    expect(result.success).toBe(true);
  });

  it('fails when cards array is empty', () => {
    const result = BulkCreateFlashcardsSchema.safeParse({ cards: [] });
    expect(result.success).toBe(false);
  });

  it('fails when card front is empty', () => {
    const result = BulkCreateFlashcardsSchema.safeParse({
      cards: [{ front: '', back: 'A1' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateFlashcardSchema', () => {
  it('passes with partial input', () => {
    const result = UpdateFlashcardSchema.safeParse({ front: 'Updated front' });
    expect(result.success).toBe(true);
  });

  it('passes with empty object (all optional)', () => {
    const result = UpdateFlashcardSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('fails when front is empty string', () => {
    const result = UpdateFlashcardSchema.safeParse({ front: '' });
    expect(result.success).toBe(false);
  });

  it('fails when back is empty string', () => {
    const result = UpdateFlashcardSchema.safeParse({ back: '' });
    expect(result.success).toBe(false);
  });
});
