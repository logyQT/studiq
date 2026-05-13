import { describe, it, expect } from 'vitest';
import { CreateTopicSchema, UpdateTopicSchema } from './flashcard-topic.model';
import { ValidationErrorCode } from '@/lib/validation-errors';

describe('CreateTopicSchema', () => {
  it('passes with valid input', () => {
    const result = CreateTopicSchema.safeParse({ name: 'Math Topics' });
    expect(result.success).toBe(true);
  });

  it('fails when name is empty', () => {
    const result = CreateTopicSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });

  it('fails when name is missing', () => {
    const result = CreateTopicSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('UpdateTopicSchema', () => {
  it('passes with partial input', () => {
    const result = UpdateTopicSchema.safeParse({ name: 'Updated Name' });
    expect(result.success).toBe(true);
  });

  it('passes with empty object (all optional)', () => {
    const result = UpdateTopicSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('fails when name is empty string', () => {
    const result = UpdateTopicSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });
});
