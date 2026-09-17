import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import {
  CreateOrganizationSchema,
  OrganizationIdParamsSchema,
  UpdateOrganizationSchema,
} from '@studiq/server/models/organization.model';
import { describe, expect, it } from 'vitest';

describe('CreateOrganizationSchema', () => {
  it('passes with valid input', () => {
    const result = CreateOrganizationSchema.safeParse({
      name: 'Test University',
    });
    expect(result.success).toBe(true);
  });

  it('fails when name is too short', () => {
    const result = CreateOrganizationSchema.safeParse({
      name: 'AB',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.TOO_SHORT);
    }
  });

  it('fails when name is missing', () => {
    const result = CreateOrganizationSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.REQUIRED);
    }
  });
});

describe('UpdateOrganizationSchema', () => {
  it('passes with valid name update', () => {
    const result = UpdateOrganizationSchema.safeParse({ name: 'Updated University' });
    expect(result.success).toBe(true);
  });

  it('passes with empty object (all optional)', () => {
    const result = UpdateOrganizationSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('fails when name is too short', () => {
    const result = UpdateOrganizationSchema.safeParse({ name: 'AB' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.TOO_SHORT);
    }
  });
});

describe('OrganizationIdParamsSchema', () => {
  it('passes with valid UUID', () => {
    const result = OrganizationIdParamsSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('fails with invalid UUID format', () => {
    const result = OrganizationIdParamsSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('fails when id is missing', () => {
    const result = OrganizationIdParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('fails when id is empty string', () => {
    const result = OrganizationIdParamsSchema.safeParse({ id: '' });
    expect(result.success).toBe(false);
  });
});
