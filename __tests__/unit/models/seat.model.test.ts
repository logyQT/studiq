import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import {
  CreatePoolSchema,
  MAX_SEAT_POOL_TOTAL,
  UpdatePoolSchema,
} from '@studiq/server/models/seat.model';
import { describe, expect, it } from 'vitest';

describe('CreatePoolSchema', () => {
  it('accepts a normal quantity', () => {
    const result = CreatePoolSchema.safeParse({ planKey: 'campus', quantity: 10 });
    expect(result.success).toBe(true);
  });

  it('accepts the int4 upper bound', () => {
    const result = CreatePoolSchema.safeParse({
      planKey: 'campus',
      quantity: MAX_SEAT_POOL_TOTAL,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a quantity above the int4 range (#266)', () => {
    const result = CreatePoolSchema.safeParse({ planKey: 'campus', quantity: 99_999_999_999 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toBe(ValidationErrorCode.TOO_BIG);
    expect(result.error.issues[0].path).toEqual(['quantity']);
  });

  it('rejects zero', () => {
    const result = CreatePoolSchema.safeParse({ planKey: 'campus', quantity: 0 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toBe(ValidationErrorCode.POSITIVE_NUMBER);
  });

  it('rejects a fractional quantity', () => {
    const result = CreatePoolSchema.safeParse({ planKey: 'campus', quantity: 1.5 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toBe(ValidationErrorCode.INTEGER);
  });

  it('rejects a string quantity', () => {
    const result = CreatePoolSchema.safeParse({ planKey: 'campus', quantity: '10' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toBe(ValidationErrorCode.NUMBER);
  });
});

describe('UpdatePoolSchema', () => {
  it('accepts zero', () => {
    const result = UpdatePoolSchema.safeParse({ total: 0 });
    expect(result.success).toBe(true);
  });

  it('accepts the int4 upper bound', () => {
    const result = UpdatePoolSchema.safeParse({ total: MAX_SEAT_POOL_TOTAL });
    expect(result.success).toBe(true);
  });

  it('rejects a total above the int4 range', () => {
    const result = UpdatePoolSchema.safeParse({ total: 99_999_999_999 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toBe(ValidationErrorCode.TOO_BIG);
    expect(result.error.issues[0].path).toEqual(['total']);
  });

  it('rejects a negative total', () => {
    const result = UpdatePoolSchema.safeParse({ total: -1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toBe(ValidationErrorCode.TOO_SMALL);
  });
});
