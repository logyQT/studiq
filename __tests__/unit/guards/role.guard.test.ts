import { AccountType } from '@studiq/authz';
import { roleGuard } from '@studiq/server/guards/role.guard';
import { describe, expect, it } from 'vitest';

describe('roleGuard', () => {
  it('returns false when role is undefined', () => {
    expect(roleGuard(undefined, [AccountType.STUDENT])).toBe(false);
  });

  it('returns true when role is in allowedRoles', () => {
    expect(roleGuard(AccountType.STUDENT, [AccountType.STUDENT, AccountType.EDUCATOR])).toBe(true);
  });

  it('returns false when role is NOT in allowedRoles', () => {
    expect(roleGuard(AccountType.STUDENT, [AccountType.EDUCATOR, AccountType.MANAGER])).toBe(false);
  });

  it('works with all role types', () => {
    const roles = [AccountType.STUDENT, AccountType.EDUCATOR, AccountType.MANAGER];

    roles.forEach((role) => {
      expect(roleGuard(role, [role])).toBe(true);
      expect(
        roleGuard(
          role,
          roles.filter((r) => r !== role),
        ),
      ).toBe(false);
    });
  });
});
