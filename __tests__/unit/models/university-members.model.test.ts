import { describe, it, expect } from 'vitest';
import { ChangeRoleSchema, RemoveMemberSchema } from '@/server/models/university-members.model';
import { ValidationErrorCode } from '@/lib/validation-errors';

describe('ChangeRoleSchema', () => {
  it('passes with valid input', () => {
    const result = ChangeRoleSchema.safeParse({
      targetUserId: 'user-123',
      newRole: 'university_admin',
    });
    expect(result.success).toBe(true);
  });

  it('fails when targetUserId is empty', () => {
    const result = ChangeRoleSchema.safeParse({
      targetUserId: '',
      newRole: 'university_admin',
    });
    expect(result.success).toBe(false);
  });

  it('fails when newRole is invalid', () => {
    const result = ChangeRoleSchema.safeParse({
      targetUserId: 'user-123',
      newRole: 'invalid_role',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_ROLE);
    }
  });

  it('fails when targetUserId is missing', () => {
    const result = ChangeRoleSchema.safeParse({ newRole: 'university_admin' });
    expect(result.success).toBe(false);
  });

  it('fails when newRole is missing', () => {
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
