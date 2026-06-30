import { describe, expect, it } from 'vitest';
import { roleGuard } from '@/server/guards/role.guard';
import { UserRole } from '@/types';

describe('roleGuard', () => {
  it('returns false when user is null', () => {
    expect(roleGuard(null, [UserRole.STUDENT])).toBe(false);
  });

  it('returns false when user has no role in app_metadata', () => {
    const user = { id: 'user-1', app_metadata: {} } as any;
    expect(roleGuard(user, [UserRole.STUDENT])).toBe(false);
  });

  it('returns true when user role is in allowedRoles', () => {
    const user = { id: 'user-1', app_metadata: { role: UserRole.STUDENT } } as any;
    expect(roleGuard(user, [UserRole.STUDENT, UserRole.TEACHER])).toBe(true);
  });

  it('returns false when user role is NOT in allowedRoles', () => {
    const user = { id: 'user-1', app_metadata: { role: UserRole.FREE } } as any;
    expect(roleGuard(user, [UserRole.STUDENT, UserRole.TEACHER])).toBe(false);
  });

  it('works with all role types', () => {
    const roles = [
      UserRole.FREE,
      UserRole.PREMIUM,
      UserRole.STUDENT,
      UserRole.TEACHER,
      UserRole.UNIVERSITY_ADMIN,
      UserRole.SYS_ADMIN,
    ];

    roles.forEach((role) => {
      const user = { id: 'user-1', app_metadata: { role } } as any;
      expect(roleGuard(user, [role])).toBe(true);
      expect(
        roleGuard(
          user,
          roles.filter((r) => r !== role),
        ),
      ).toBe(false);
    });
  });
});
