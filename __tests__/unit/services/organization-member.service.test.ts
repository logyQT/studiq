import { toMemberRows } from '@studiq/server/services/organization-member.service';
import { describe, expect, it } from 'vitest';

// The roster's persona field (D33): `listMembers` selects `profiles.account_type`
// and maps it to `accountType`, because the seats page filters seat pools by the
// member's persona, not by the org role name.

type MemberRow = Parameters<typeof toMemberRows>[0][number];

function memberRow(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    user_id: 'u-1',
    org_role_id: 'role-1',
    org_roles: { name: 'member', display_name: null },
    profiles: {
      email: 'student@example.com',
      full_name: 'QA student',
      created_at: '2026-11-01T10:00:00Z',
      account_type: 'student',
    },
    ...overrides,
  };
}

describe('toMemberRows', () => {
  it('maps the profile account_type to the roster row accountType', () => {
    const rows = toMemberRows([memberRow()], 'org-1', {});

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'u-1',
      email: 'student@example.com',
      full_name: 'QA student',
      accountType: 'student',
      orgRoleName: 'member',
      orgRoleDisplayName: 'member',
      orgRoleId: 'role-1',
      organization_id: 'org-1',
      created_at: '2026-11-01T10:00:00Z',
      groups: [],
    });
  });

  it('keeps each persona distinct from the org role (a student may hold admin)', () => {
    const rows = toMemberRows(
      [
        memberRow({
          user_id: 'u-2',
          org_roles: { name: 'admin', display_name: 'Administrator' },
          profiles: {
            email: 'manager@example.com',
            full_name: 'QA manager',
            created_at: null,
            account_type: 'manager',
          },
        }),
      ],
      'org-1',
      { 'u-2': [{ id: 'g-1', name: 'G1', role: 'member' }] },
    );

    expect(rows[0]?.accountType).toBe('manager');
    expect(rows[0]?.orgRoleName).toBe('admin');
    expect(rows[0]?.groups).toEqual([{ id: 'g-1', name: 'G1', role: 'member' }]);
  });
});
