import { AccountType, type RequestContext } from '@studiq/authz';
import { OrganizationMemberService } from '@studiq/server/services/organization-member.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

type QueryResult = { data: unknown; error: unknown };

/** A chainable Supabase query builder stub that is also awaitable. */
type QueryBuilder = {
  select: Mock;
  eq: Mock;
  in: Mock;
  or: Mock;
  order: Mock;
  filter: Mock;
  limit: Mock;
  single: Mock;
  maybeSingle: Mock;
  insert: Mock;
  update: Mock;
  delete: Mock;
  upsert: Mock;
} & Pick<Promise<QueryResult>, 'then'>;

function chain(result: unknown): QueryBuilder {
  const resolved: QueryResult = { data: result, error: null };
  const terminal = vi.fn().mockResolvedValue(resolved);
  const promise = Promise.resolve(resolved);
  const c: QueryBuilder = {
    select: vi.fn(() => c),
    eq: vi.fn(() => c),
    in: vi.fn(() => c),
    or: vi.fn(() => c),
    order: vi.fn(() => c),
    filter: vi.fn(() => c),
    limit: vi.fn(() => c),
    single: terminal,
    maybeSingle: terminal,
    insert: vi.fn(() => c),
    update: vi.fn(() => c),
    delete: vi.fn(() => c),
    upsert: vi.fn(() => c),
    then: promise.then.bind(promise),
  };
  return c;
}

describe('OrganizationMemberService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.STUDENT,
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: 'uni-1',
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };
  const service = new OrganizationMemberService(() => Promise.resolve(mock));

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    // §4.4 (row 13): changeRole asks the rls_caller_may_assign_org_role wrapper
    // before updating; allowed unless a test says otherwise.
    mock.rpc.mockResolvedValue({ data: true, error: null });
  });

  describe('getProfile', () => {
    it('returns profile when found', async () => {
      const profile = {
        id: ctx.userId,
        email: 'test@test.com',
        full_name: null,
        created_at: '2024-01-01',
      };
      const profileChain = chain(profile);
      mock.from.mockReturnValue(profileChain);

      const result = await service.getProfile(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(profile);
      expect(mock.from).toHaveBeenCalledWith('profiles');
      expect(profileChain.eq).toHaveBeenCalledWith('id', ctx.userId);
      expect(profileChain.select).toHaveBeenCalledWith('id, email, full_name, created_at');
    });

    it('returns NOT_FOUND when profile does not exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.getProfile(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('listMembers', () => {
    it('returns members for organization', async () => {
      const orgRole = { name: 'student' };
      const profile = {
        id: 'user-1',
        email: 'test@test.com',
        full_name: null,
        created_at: '2024-01-01',
      };
      const members = [
        {
          user_id: 'user-1',
          org_role_id: 'role-1',
          org_roles: orgRole,
          profiles: profile,
          organization_id: 'uni-1',
        },
      ];

      const orgChain = chain(members);
      const groupChain = chain([]);

      mock.from.mockReturnValueOnce(orgChain);
      mock.from.mockReturnValue(groupChain);

      const result = await service.listMembers(ctx);

      expect(result.success).toBe(true);
      expect(orgChain.eq).toHaveBeenCalledWith('organization_id', ctx.activeOrgId);
      expect(orgChain.select).toHaveBeenCalledWith(expect.stringContaining('org_roles!inner'));
      expect(groupChain.in).toHaveBeenCalledWith('user_id', ['user-1']);
      expect(groupChain.eq).toHaveBeenCalledWith('groups.organization_id', ctx.activeOrgId);
      expect(result.data).toEqual([
        {
          id: 'user-1',
          email: 'test@test.com',
          full_name: null,
          orgRoleName: 'student',
          orgRoleDisplayName: 'student',
          orgRoleId: 'role-1',
          organization_id: 'uni-1',
          created_at: '2024-01-01',
          groups: [],
        },
      ]);
    });

    it('returns INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      const result = await service.listMembers(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('changeRole', () => {
    it('changes role successfully', async () => {
      mock.from
        // Target role must belong to the active org (#191 B2 defense in depth).
        .mockReturnValueOnce(chain({ id: 'role-1', organization_id: 'uni-1' }))
        .mockReturnValueOnce(chain([{ user_id: 'user-123' }]));

      const result = await service.changeRole(
        ctx,
        'user-123',
        '00000000-0000-4000-8000-000000000001',
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ success: true });
      expect(mock.rpc).toHaveBeenCalledWith('rls_caller_may_assign_org_role', {
        p_role_id: '00000000-0000-4000-8000-000000000001',
      });
      expect(mock.from).toHaveBeenNthCalledWith(1, 'org_roles');
      expect(mock.from).toHaveBeenNthCalledWith(2, 'org_members');
    });

    it('returns FORBIDDEN when the assignment wrapper refuses the new role', async () => {
      mock.from.mockReturnValueOnce(chain({ id: 'role-1', organization_id: 'uni-1' }));
      mock.rpc.mockResolvedValueOnce({ data: false, error: null });

      const result = await service.changeRole(
        ctx,
        'user-123',
        '00000000-0000-4000-8000-000000000001',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      // Only the role lookup ran — no org_members update was issued.
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).toHaveBeenCalledWith('org_roles');
    });

    it('returns FORBIDDEN when the target role belongs to another organization', async () => {
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.changeRole(
        ctx,
        'user-123',
        '00000000-0000-4000-8000-000000000002',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('returns NOT_FOUND when the member update affects no rows', async () => {
      mock.from
        .mockReturnValueOnce(chain({ id: 'role-1', organization_id: 'uni-1' }))
        .mockReturnValueOnce(chain([]));

      const result = await service.changeRole(
        ctx,
        'user-123',
        '00000000-0000-4000-8000-000000000001',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns FORBIDDEN when user tries to change own role', async () => {
      const result = await service.changeRole(
        ctx,
        ctx.userId,
        '00000000-0000-4000-8000-000000000001',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns FORBIDDEN when no activeOrgId', async () => {
      const noOrgCtx = { ...ctx, activeOrgId: null };
      const result = await service.changeRole(
        noOrgCtx,
        'user-123',
        '00000000-0000-4000-8000-000000000001',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });
  });

  describe('removeMember', () => {
    it('removes member successfully', async () => {
      const memberChain = chain([{ user_id: 'user-123' }]);
      const seatChain = chain([{ user_id: 'user-123' }]);
      mock.from.mockReturnValueOnce(memberChain).mockReturnValueOnce(seatChain);

      const result = await service.removeMember(ctx, 'user-123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ success: true });
      // Member first, seat second — both scoped to the org and the target user.
      expect(memberChain.eq).toHaveBeenCalledWith('organization_id', ctx.activeOrgId);
      expect(memberChain.eq).toHaveBeenCalledWith('user_id', 'user-123');
      expect(mock.from).toHaveBeenCalledWith('org_seat_assignments');
      expect(seatChain.delete).toHaveBeenCalled();
      expect(seatChain.eq).toHaveBeenCalledWith('organization_id', ctx.activeOrgId);
      expect(seatChain.eq).toHaveBeenCalledWith('user_id', 'user-123');
    });

    // #189: a 0-row delete used to return {"success":true}. Same contract as
    // changeRole — an unknown/foreign target is NOT_FOUND, and seats are not
    // touched by a no-op.
    it('returns NOT_FOUND when the delete affects no rows', async () => {
      mock.from.mockReturnValueOnce({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      });

      const result = await service.removeMember(ctx, 'user-404');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      // The seat cleanup never runs for a no-op: only the org_members delete ran.
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).toHaveBeenCalledWith('org_members');
    });

    it('returns FORBIDDEN when user tries to remove self', async () => {
      const result = await service.removeMember(ctx, ctx.userId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });
  });
});
