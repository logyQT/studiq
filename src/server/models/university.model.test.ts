import { describe, it, expect } from 'vitest';
import { CreateUniversitySchema } from './university.model';
import { ValidationErrorCode } from '@/lib/validation-errors';

describe('CreateUniversitySchema', () => {
  it('passes with valid input', () => {
    const result = CreateUniversitySchema.safeParse({
      name: 'Test University',
      slug: 'test-university',
    });
    expect(result.success).toBe(true);
  });

  it('fails when name is too short', () => {
    const result = CreateUniversitySchema.safeParse({
      name: 'AB',
      slug: 'test-university',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_TOO_SHORT);
    }
  });

  it('fails when name is missing', () => {
    const result = CreateUniversitySchema.safeParse({ slug: 'test-university' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_REQUIRED);
    }
  });

  it('fails when slug has invalid format', () => {
    const result = CreateUniversitySchema.safeParse({
      name: 'Test University',
      slug: 'Test_University',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_INVALID_FORMAT);
    }
  });

  it('fails when slug is too short', () => {
    const result = CreateUniversitySchema.safeParse({
      name: 'Test University',
      slug: 'a',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });

  it('fails when slug is missing', () => {
    const result = CreateUniversitySchema.safeParse({ name: 'Test University' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });
});
