import { describe, it, expect } from 'vitest';
import { CreateOrganizationSchema, UpdateOrganizationSchema, OrganizationIdParamsSchema } from '@/server/models/organization.model';
import { ValidationErrorCode } from '@/lib/validation-errors';

describe('CreateOrganizationSchema', () => {
  it('passes with valid input', () => {
    const result = CreateOrganizationSchema.safeParse({
      name: 'Test University',
      slug: 'test-university',
    });
    expect(result.success).toBe(true);
  });

  it('fails when name is too short', () => {
    const result = CreateOrganizationSchema.safeParse({
      name: 'AB',
      slug: 'test-university',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_TOO_SHORT);
    }
  });

  it('fails when name is missing', () => {
    const result = CreateOrganizationSchema.safeParse({ slug: 'test-university' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_REQUIRED);
    }
  });

  it('fails when slug has invalid format', () => {
    const result = CreateOrganizationSchema.safeParse({
      name: 'Test University',
      slug: 'Test_University',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_INVALID_FORMAT);
    }
  });

  it('fails when slug is too short', () => {
    const result = CreateOrganizationSchema.safeParse({
      name: 'Test University',
      slug: 'a',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });

  it('fails when slug is missing', () => {
    const result = CreateOrganizationSchema.safeParse({ name: 'Test University' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });
});

describe('UpdateOrganizationSchema', () => {
  it('passes with valid name update', () => {
    const result = UpdateOrganizationSchema.safeParse({ name: 'Updated University' });
    expect(result.success).toBe(true);
  });

  it('passes with valid slug update', () => {
    const result = UpdateOrganizationSchema.safeParse({ slug: 'updated-slug' });
    expect(result.success).toBe(true);
  });

  it('passes with both name and slug update', () => {
    const result = UpdateOrganizationSchema.safeParse({
      name: 'Updated University',
      slug: 'updated-slug',
    });
    expect(result.success).toBe(true);
  });

  it('fails when both name and slug are missing', () => {
    const result = UpdateOrganizationSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('fails when name is too short', () => {
    const result = UpdateOrganizationSchema.safeParse({ name: 'AB' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_TOO_SHORT);
    }
  });

  it('fails when slug has invalid format', () => {
    const result = UpdateOrganizationSchema.safeParse({ slug: 'Invalid_Slug!' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.NAME_INVALID_FORMAT);
    }
  });

  it('fails when slug is too short', () => {
    const result = UpdateOrganizationSchema.safeParse({ slug: 'a' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
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
