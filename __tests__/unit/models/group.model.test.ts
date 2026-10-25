import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { CreateGroupSchema, UpdateGroupSchema } from '@studiq/server/models/group.model';
import { describe, expect, it } from 'vitest';

describe.each([
  ['CreateGroupSchema', CreateGroupSchema],
  ['UpdateGroupSchema', UpdateGroupSchema],
] as const)('%s name', (_label, schema) => {
  it('rejects a whitespace-only name', () => {
    const result = schema.safeParse({ name: '   ' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['name']);
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.REQUIRED);
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        ValidationErrorCode.TOO_SHORT,
      );
    }
  });

  it('rejects an empty name', () => {
    const result = schema.safeParse({ name: '' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.REQUIRED);
    }
  });

  it('trims a padded name', () => {
    const result = schema.safeParse({ name: '  My Group  ' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My Group');
    }
  });

  it('rejects a name that is too short after trimming', () => {
    const result = schema.safeParse({ name: '  ab  ' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.TOO_SHORT);
    }
  });

  it('accepts a 64-character name', () => {
    const result = schema.safeParse({ name: 'a'.repeat(64) });

    expect(result.success).toBe(true);
  });

  it('rejects a 65-character name', () => {
    const result = schema.safeParse({ name: 'a'.repeat(65) });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.TOO_LONG);
    }
  });

  it('measures the length limit after trimming', () => {
    const result = schema.safeParse({ name: `   ${'a'.repeat(64)}   ` });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('a'.repeat(64));
    }
  });
});

describe('UpdateGroupSchema', () => {
  it('accepts an empty body (name stays optional)', () => {
    const result = UpdateGroupSchema.safeParse({});

    expect(result.success).toBe(true);
  });

  it('accepts a description-only body', () => {
    const result = UpdateGroupSchema.safeParse({ description: 'only desc' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('name');
    }
  });
});

describe('CreateGroupSchema', () => {
  it('requires a name', () => {
    const result = CreateGroupSchema.safeParse({ description: 'only desc' });

    expect(result.success).toBe(false);
  });
});
