import { describe, it, expect } from 'vitest';
import { CreateSubjectSchema, UpdateSubjectSchema } from './subject.model';
import { ValidationErrorCode } from '@/lib/validation-errors';

describe('CreateSubjectSchema', () => {
  it('passes with valid input', () => {
    const result = CreateSubjectSchema.safeParse({ name: 'Math 101' });
    expect(result.success).toBe(true);
  });

  it('passes with optional fields', () => {
    const result = CreateSubjectSchema.safeParse({
      name: 'Math 101',
      description: 'Intro to math',
      universityId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('fails when name is empty', () => {
    const result = CreateSubjectSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });

  it('fails when name is missing', () => {
    const result = CreateSubjectSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('UpdateSubjectSchema', () => {
  it('passes with partial input', () => {
    const result = UpdateSubjectSchema.safeParse({ name: 'Updated Name' });
    expect(result.success).toBe(true);
  });

  it('passes with empty object (all optional)', () => {
    const result = UpdateSubjectSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('fails when name is empty string', () => {
    const result = UpdateSubjectSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });
});
