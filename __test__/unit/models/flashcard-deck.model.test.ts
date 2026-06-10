import { describe, it, expect } from 'vitest';
import { CreateDeckSchema, UpdateDeckSchema } from '@/server/models/flashcard-deck.model';
import { ValidationErrorCode } from '@/lib/validation-errors';

describe('CreateDeckSchema', () => {
  it('passes with valid input', () => {
    const result = CreateDeckSchema.safeParse({ name: 'Study Deck' });
    expect(result.success).toBe(true);
  });

  it('passes with optional fields', () => {
    const result = CreateDeckSchema.safeParse({
      name: 'Study Deck',
      description: 'A deck for studying',
      flashcardIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });
    expect(result.success).toBe(true);
  });

  it('fails when name is empty', () => {
    const result = CreateDeckSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });

  it('fails when flashcardIds contains invalid UUID', () => {
    const result = CreateDeckSchema.safeParse({
      name: 'Study Deck',
      flashcardIds: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateDeckSchema', () => {
  it('passes with partial input', () => {
    const result = UpdateDeckSchema.safeParse({ name: 'Updated Name' });
    expect(result.success).toBe(true);
  });

  it('passes with empty object (all optional)', () => {
    const result = UpdateDeckSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('fails when name is empty string', () => {
    const result = UpdateDeckSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });
});
