import { AccountType, type RequestContext } from '@studiq/authz';
import {
  OrganizationMemberService,
  toMemberRows,
} from '@studiq/server/services/organization-member.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

// The roster's persona field (D33): `listMembers` selects `profiles.account_type`
// and maps it to `accountType`, because the seats page filters seat pools by the
// member's persona, not by the org role name.

type MemberRow = Parameters<typeof toMemberRows>[0][number];

type QueryResult = { data: unknown; error: unknown };

/** A thenable query-builder stand-in: every chain method returns itself. */
type QueryChain = {
  select: Mock<(...args: unknown[]) => QueryChain>;
  update: Mock<(...args: unknown[]) => QueryChain>;
  eq: Mock<(...args: unknown[]) => QueryChain>;
  maybeSingle: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  then: Promise<QueryResult>['then'];
  catch: Promise<QueryResult>['catch'];
  finally: Promise<QueryResult>['finally'];
};

function qb(data: unknown, error: unknown = null) {
  const promise = Promise.resolve<QueryResult>({ data: data ?? null, error });
  const b: QueryChain = {
    select: vi.fn(() => b),
    update: vi.fn(() => b),
    eq: vi.fn(() => b),
    maybeSingle: vi.fn().mockResolvedValue({ data: data ?? null, error }),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return b;
}

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

describe('OrganizationMemberService.changeRole — §4.4 assignment gate', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: OrganizationMemberService;
  const ctx: RequestContext = {
    userId: 'manager-1',
    accountType: AccountType.MANAGER,
    traceId: 'test',
    url: '',
    method: 'PUT',
    activeOrgId: 'org-1',
    orgRoleId: 'role-manager',
    groupIds: [],
    permissionScopes: { 'org.member.manage': 'organization' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new OrganizationMemberService(() => Promise.resolve(mock));
  });

  function seedRoleLookup(role: unknown = { id: 'role-2', organization_id: 'org-1' }) {
    mock.from.mockReturnValueOnce(qb(role)); // org_roles lookup
  }

  it('refuses with FORBIDDEN and issues no update when the assignment RPC says no', async () => {
    seedRoleLookup();
    mock.rpc.mockResolvedValueOnce({ data: false, error: null });

    const result = await service.changeRole(ctx, 'member-1', 'role-2');

    expect(result).toEqual({ success: false, error: 'FORBIDDEN' });
    expect(mock.rpc).toHaveBeenCalledWith('rls_caller_may_assign_org_role', {
      p_role_id: 'role-2',
    });
    // Only the role lookup ran — the org_members update was never issued.
    expect(mock.from).toHaveBeenCalledTimes(1);
    expect(mock.from).toHaveBeenCalledWith('org_roles');
  });

  it('refuses with FORBIDDEN when the assignment RPC errors', async () => {
    seedRoleLookup();
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    const result = await service.changeRole(ctx, 'member-1', 'role-2');

    expect(result).toEqual({ success: false, error: 'FORBIDDEN' });
    expect(mock.from).toHaveBeenCalledTimes(1);
  });

  it('updates the role when the assignment RPC allows it', async () => {
    seedRoleLookup();
    mock.rpc.mockResolvedValueOnce({ data: true, error: null });
    const updateQuery = qb([{ user_id: 'member-1' }]);
    mock.from.mockReturnValueOnce(updateQuery); // org_members update

    const result = await service.changeRole(ctx, 'member-1', 'role-2');

    expect(result).toEqual({ success: true, data: { success: true } });
    expect(mock.rpc).toHaveBeenCalledWith('rls_caller_may_assign_org_role', {
      p_role_id: 'role-2',
    });
    expect(updateQuery.update).toHaveBeenCalledWith({ org_role_id: 'role-2' });
    expect(updateQuery.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(updateQuery.eq).toHaveBeenCalledWith('user_id', 'member-1');
  });

  it('still refuses a cross-org role id before the RPC', async () => {
    seedRoleLookup(null);

    const result = await service.changeRole(ctx, 'member-1', 'role-foreign');

    expect(result).toEqual({ success: false, error: 'FORBIDDEN' });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.from).toHaveBeenCalledTimes(1);
  });
});
