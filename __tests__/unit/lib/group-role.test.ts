import { describe, expect, it } from 'vitest';
import { defaultGroupRole } from '@/lib/group-role';

describe('defaultGroupRole', () => {
  it('prefills org teachers as group teachers', () => {
    expect(defaultGroupRole('teacher')).toBe('teacher');
  });

  it('prefills org members as plain group members', () => {
    expect(defaultGroupRole('member')).toBe('member');
  });

  it('keeps org admins and custom org roles as plain members', () => {
    expect(defaultGroupRole('admin')).toBe('member');
    expect(defaultGroupRole('head of department')).toBe('member');
  });

  it('falls back to member when the org role is missing', () => {
    expect(defaultGroupRole(null)).toBe('member');
    expect(defaultGroupRole(undefined)).toBe('member');
    expect(defaultGroupRole('')).toBe('member');
  });

  it('is case-sensitive, matching the seeded org role name', () => {
    expect(defaultGroupRole('Teacher')).toBe('member');
  });
});
