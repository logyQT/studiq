import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { CreateDeckSchema, UpdateDeckSchema } from '@studiq/server/models/flashcard-deck.model';
import { describe, expect, it } from 'vitest';

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
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.REQUIRED);
    }
  });

  it('fails when flashcardIds contains invalid UUID', () => {
    const result = CreateDeckSchema.safeParse({
      name: 'Study Deck',
      flashcardIds: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });

  // #139 — a group-visible deck with no share link is readable only by its creator.
  it('fails when visibility is group without any groupIds', () => {
    const result = CreateDeckSchema.safeParse({ name: 'Study Deck', visibility: 'group' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['groupIds']);
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.REQUIRED);
    }
  });

  it('fails when visibility is group with an empty groupIds list', () => {
    const result = CreateDeckSchema.safeParse({
      name: 'Study Deck',
      visibility: 'group',
      groupIds: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['groupIds']);
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.REQUIRED);
    }
  });

  it('passes for personal visibility without groupIds', () => {
    const result = CreateDeckSchema.safeParse({ name: 'Study Deck', visibility: 'personal' });
    expect(result.success).toBe(true);
  });

  it('passes for group visibility with one group', () => {
    const result = CreateDeckSchema.safeParse({
      name: 'Study Deck',
      visibility: 'group',
      groupIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });
    expect(result.success).toBe(true);
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

  // #139 — the schema only rejects what is invalid on its own; `groupIds: undefined`
  // ("keep the existing links") is judged by the service against the stored deck.
  it('fails when switching to group with an empty groupIds list', () => {
    const result = UpdateDeckSchema.safeParse({ visibility: 'group', groupIds: [] });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['groupIds']);
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.REQUIRED);
    }
  });

  it('passes when switching to group without a groupIds list', () => {
    expect(UpdateDeckSchema.safeParse({ visibility: 'group' }).success).toBe(true);
  });

  it('passes for an empty groupIds list (the service decides)', () => {
    expect(UpdateDeckSchema.safeParse({ groupIds: [] }).success).toBe(true);
  });

  it('passes when switching to personal with an empty groupIds list', () => {
    expect(UpdateDeckSchema.safeParse({ visibility: 'personal', groupIds: [] }).success).toBe(true);
  });
});
