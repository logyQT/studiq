import { describe, expect, it } from 'vitest';
import { ValidationErrorCode } from '@/lib/validation-errors';
import { ChangeRoleSchema, RemoveMemberSchema } from '@/server/models/organization-member.model';

describe('ChangeRoleSchema', () => {
  it('passes with valid input', () => {
    const result = ChangeRoleSchema.safeParse({
      targetUserId: 'user-123',
      newOrgRoleId: '00000000-0000-4000-8000-000000000001',
    });
    expect(result.success).toBe(true);
  });

  it('fails when targetUserId is empty', () => {
    const result = ChangeRoleSchema.safeParse({
      targetUserId: '',
      newOrgRoleId: '00000000-0000-4000-8000-000000000001',
    });
    expect(result.success).toBe(false);
  });

  it('fails when newOrgRoleId is invalid', () => {
    const result = ChangeRoleSchema.safeParse({
      targetUserId: 'user-123',
      newOrgRoleId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_ROLE);
    }
  });

  it('fails when targetUserId is missing', () => {
    const result = ChangeRoleSchema.safeParse({ newOrgRoleId: '00000000-0000-4000-8000-000000000001' });
    expect(result.success).toBe(false);
  });

  it('fails when newOrgRoleId is missing', () => {
    const result = ChangeRoleSchema.safeParse({ targetUserId: 'user-123' });
    expect(result.success).toBe(false);
  });
});

describe('RemoveMemberSchema', () => {
  it('passes with valid input', () => {
    const result = RemoveMemberSchema.safeParse({ targetUserId: 'user-123' });
    expect(result.success).toBe(true);
  });

  it('fails when targetUserId is empty', () => {
    const result = RemoveMemberSchema.safeParse({ targetUserId: '' });
    expect(result.success).toBe(false);
  });

  it('fails when targetUserId is missing', () => {
    const result = RemoveMemberSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
