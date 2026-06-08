import { describe, it, expect } from 'vitest';
import {
  CreateFlashcardSchema,
  BulkCreateFlashcardsSchema,
  UpdateFlashcardSchema,
} from './flashcard.model';

describe('CreateFlashcardSchema', () => {
  it('passes with valid input', () => {
    const result = CreateFlashcardSchema.safeParse({ front: 'Q', back: 'A' });
    expect(result.success).toBe(true);
  });

  it('passes with optional topicIds and deckIds', () => {
    const result = CreateFlashcardSchema.safeParse({
      front: 'Q',
      back: 'A',
      topicIds: ['550e8400-e29b-41d4-a716-446655440000'],
      deckIds: ['550e8400-e29b-41d4-a716-446655440001'],
    });
    expect(result.success).toBe(true);
  });

  it('fails when front is empty', () => {
    const result = CreateFlashcardSchema.safeParse({ front: '', back: 'A' });
    expect(result.success).toBe(false);
  });

  it('fails when back is empty', () => {
    const result = CreateFlashcardSchema.safeParse({ front: 'Q', back: '' });
    expect(result.success).toBe(false);
  });

  it('fails when topicIds contains invalid UUID', () => {
    const result = CreateFlashcardSchema.safeParse({
      front: 'Q',
      back: 'A',
      topicIds: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });

  it('fails when deckIds contains invalid UUID', () => {
    const result = CreateFlashcardSchema.safeParse({
      front: 'Q',
      back: 'A',
      deckIds: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });
});

describe('BulkCreateFlashcardsSchema', () => {
  it('passes with valid cards', () => {
    const result = BulkCreateFlashcardsSchema.safeParse({
      cards: [{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }],
    });
    expect(result.success).toBe(true);
  });

  it('passes with optional topicIds and deckIds', () => {
    const result = BulkCreateFlashcardsSchema.safeParse({
      topicIds: ['550e8400-e29b-41d4-a716-446655440000'],
      deckIds: ['550e8400-e29b-41d4-a716-446655440001'],
      cards: [{ front: 'Q1', back: 'A1' }],
    });
    expect(result.success).toBe(true);
  });

  it('fails with empty cards array', () => {
    const result = BulkCreateFlashcardsSchema.safeParse({ cards: [] });
    expect(result.success).toBe(false);
  });
});

describe('UpdateFlashcardSchema', () => {
  it('passes with partial input', () => {
    const result = UpdateFlashcardSchema.safeParse({ front: 'Updated Q' });
    expect(result.success).toBe(true);
  });

  it('passes with optional topicIds and deckIds', () => {
    const result = UpdateFlashcardSchema.safeParse({
      front: 'Updated Q',
      topicIds: ['550e8400-e29b-41d4-a716-446655440000'],
      deckIds: ['550e8400-e29b-41d4-a716-446655440001'],
    });
    expect(result.success).toBe(true);
  });

  it('fails with empty front', () => {
    const result = UpdateFlashcardSchema.safeParse({ front: '' });
    expect(result.success).toBe(false);
  });

  it('passes with empty object (all optional)', () => {
    const result = UpdateFlashcardSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
