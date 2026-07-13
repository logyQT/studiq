import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { OrganizationMemberService } from '@/server/services/organization-member.service';
import { success, failure } from '@/lib/service-result';
import type { RequestContext } from '@/lib/request-context';
import { AccountType } from '@/types';

function chain(result: any) {
  const resolved = { data: result, error: null };
  const terminal = vi.fn().mockResolvedValue(resolved);
  const c: any = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.or = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.filter = vi.fn(() => c);
  c.limit = vi.fn(() => c);
  c.single = terminal;
  c.maybeSingle = terminal;
  c.insert = vi.fn(() => c);
  c.update = vi.fn(() => c);
  c.delete = vi.fn(() => c);
  c.upsert = vi.fn(() => c);
  c.then = (onfulfilled: any) => Promise.resolve(resolved).then(onfulfilled);
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
  const service = new OrganizationMemberService(async () => mock as any);

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('getProfile', () => {
    it('returns profile when found', async () => {
      const profile = {
        id: ctx.userId,
        email: 'test@test.com',
        full_name: null,
        created_at: '2024-01-01',
      };
      mock.from.mockReturnValue(chain(profile));

      const result = await service.getProfile(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(profile);
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
      const profile = { id: 'user-1', email: 'test@test.com', full_name: null, created_at: '2024-01-01' };
      const members = [
        {
          user_id: 'user-1',
          org_role_id: 'role-1',
          org_roles: orgRole,
          profiles: profile,
          organization_id: 'uni-1',
        },
      ];

      const orgResolved = {
        data: members,
        error: null,
      };
      const orgTerminal = vi.fn().mockResolvedValue(orgResolved);
      const orgChain: any = {};
      orgChain.select = vi.fn(() => orgChain);
      orgChain.eq = vi.fn(() => orgChain);
      orgChain.order = orgTerminal;
      orgChain.then = (onfulfilled: any) => Promise.resolve(orgResolved).then(onfulfilled);

      const groupResolved = {
        data: [],
        error: null,
      };
      const groupTerminal = vi.fn().mockResolvedValue(groupResolved);
      const groupChain: any = {};
      groupChain.select = vi.fn(() => groupChain);
      groupChain.in = groupTerminal;
      groupChain.then = (onfulfilled: any) => Promise.resolve(groupResolved).then(onfulfilled);

      mock.from.mockReturnValueOnce(orgChain);
      mock.from.mockReturnValue(groupChain);

      const result = await service.listMembers(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
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
      mock.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      const result = await service.changeRole(
        ctx,
        'user-123',
        '00000000-0000-4000-8000-000000000001',
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ success: true });
      expect(mock.from).toHaveBeenCalledWith('org_members');
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
      mock.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      const result = await service.removeMember(ctx, 'user-123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ success: true });
    });

    it('returns FORBIDDEN when user tries to remove self', async () => {
      const result = await service.removeMember(ctx, ctx.userId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });
  });
});
