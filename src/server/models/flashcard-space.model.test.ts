import { describe, it, expect } from 'vitest';
import { CreateSpaceSchema, UpdateSpaceSchema } from './flashcard-space.model';
import { ValidationErrorCode } from '@/lib/validation-errors';

describe('CreateSpaceSchema', () => {
  it('passes with valid input', () => {
    const result = CreateSpaceSchema.safeParse({ name: 'Study Space' });
    expect(result.success).toBe(true);
  });

  it('passes with optional fields', () => {
    const result = CreateSpaceSchema.safeParse({
      name: 'Study Space',
      description: 'A space for studying',
      flashcardIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });
    expect(result.success).toBe(true);
  });

  it('fails when name is empty', () => {
    const result = CreateSpaceSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });

  it('fails when flashcardIds contains invalid UUID', () => {
    const result = CreateSpaceSchema.safeParse({
      name: 'Study Space',
      flashcardIds: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateSpaceSchema', () => {
  it('passes with partial input', () => {
    const result = UpdateSpaceSchema.safeParse({ name: 'Updated Name' });
    expect(result.success).toBe(true);
  });

  it('passes with empty object (all optional)', () => {
    const result = UpdateSpaceSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('fails when name is empty string', () => {
    const result = UpdateSpaceSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });
});
