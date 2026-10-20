import { AccountType, type RequestContext } from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { InvitationService } from '@studiq/server/services/invitation.service';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/services/limits.resolver', () => ({
  limitsResolver: {
    checkLimit: vi.fn().mockResolvedValue(undefined),
    checkOrgLimit: vi.fn().mockResolvedValue(undefined),
  },
}));

function qb(data: any, error: any = null) {
  const result = { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.upsert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.limit = vi.fn(() => b);
  b.or = vi.fn(() => b);
  b.not = vi.fn(() => b);
  b.neq = vi.fn(() => b);
  b.rpc = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('InvitationService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: InvitationService;

  const managerCtx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.MANAGER,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  const educatorCtx: RequestContext = {
    userId: 'test-user-id-2',
    accountType: AccountType.EDUCATOR,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: 'uni-1',
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  const studentCtx: RequestContext = {
    userId: 'test-user-id-3',
    accountType: AccountType.STUDENT,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new InvitationService(async () => mock as any);
  });

  describe('createInvitation', () => {
    it('creates invitation for manager with organizationId', async () => {
      mock.from.mockReturnValueOnce(qb({ token: 'abc123' }));

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
      vi.stubEnv('NODE_ENV', 'development');

      const result = await service.createInvitation(managerCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
        organizationId: 'uni-1',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).inviteLink).toContain('abc123');

      vi.unstubAllEnvs();
    });

    it('returns NOT_FOUND when manager has no organizationId', async () => {
      const result = await service.createInvitation(managerCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('creates invitation for educator with activeOrgId', async () => {
      mock.from.mockReturnValueOnce(qb({ token: 'abc123' }));

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
      vi.stubEnv('NODE_ENV', 'development');

      const result = await service.createInvitation(educatorCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).success).toBe(true);

      vi.unstubAllEnvs();
    });

    it('returns FORBIDDEN for student account type', async () => {
      const result = await service.createInvitation(studentCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns INTERNAL_SERVER when SITE_URL is not set', async () => {
      mock.from.mockReturnValueOnce(qb({ token: 'abc123' }));

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');

      const result = await service.createInvitation(
        { ...managerCtx, activeOrgId: 'uni-1' },
        { email: 'john@example.com', targetOrgRoleId: 'member' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');

      vi.unstubAllEnvs();
    });

    it('returns INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

      const result = await service.createInvitation(
        { ...managerCtx, activeOrgId: 'uni-1' },
        { email: 'john@example.com', targetOrgRoleId: 'member' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');

      vi.unstubAllEnvs();
    });
  });

  describe('getInvitationByToken', () => {
    it('returns invitation when found and valid', async () => {
      const invitation = {
        email: 'john@example.com',
        organization_id: 'uni-1',
        target_org_role_id: 'member',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        organizations: { name: 'Test Uni' } as any,
        org_roles: { name: 'Member' } as any,
      };
      mock.from.mockReturnValueOnce(qb(invitation));

      const result = await service.getInvitationByToken('valid-token');

      expect(result.success).toBe(true);
      expect((result.data as any).email).toBe('john@example.com');
    });

    it('returns NOT_FOUND when token does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getInvitationByToken('invalid');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns GONE when token is expired', async () => {
      const invitation = {
        email: 'john@example.com',
        organization_id: 'uni-1',
        target_org_role_id: 'member',
        expires_at: new Date(Date.now() - 86400000).toISOString(),
        organizations: { name: 'Test Uni' } as any,
        org_roles: { name: 'Member' } as any,
      };
      mock.from.mockReturnValueOnce(qb(invitation));

      const result = await service.getInvitationByToken('expired');

      expect(result.success).toBe(false);
      expect(result.error).toBe('GONE');
    });
  });

  describe('acceptInvitation', () => {
    const invitation = {
      email: 'new@example.com',
      organization_id: 'org-1',
      target_org_role_id: 'role-member',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      organizations: { name: 'Test Org' } as any,
      org_roles: { name: 'member' } as any,
    };
    const joiningCtx: RequestContext = { ...managerCtx, userId: 'joining-user' };

    function adminClientWithCount(count: number) {
      const c: any = {};
      c.select = vi.fn(() => c);
      c.eq = vi.fn().mockResolvedValue({ count, error: null });
      const from = vi.fn(() => c);
      return { client: { from } as any, from };
    }

    it('counts members with the admin client, not the joining user (#182)', async () => {
      const admin = adminClientWithCount(5);
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );
      vi.mocked(limitsResolver.checkOrgLimit).mockRejectedValueOnce(
        new AppError('USAGE_LIMIT_EXCEEDED'),
      );
      mock.from.mockReturnValueOnce(qb(invitation));

      await expect(service.acceptInvitation(joiningCtx, 'tok')).rejects.toThrow();

      expect(admin.from).toHaveBeenCalledWith('org_members');
      expect(limitsResolver.checkOrgLimit).toHaveBeenCalledWith('org-1', 'max_students', 5);
      // user-scoped client only looked up the invitation: no member count, no insert
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).toHaveBeenCalledWith('invitations');
    });

    it('adds the member when the organization is below its limit', async () => {
      const admin = adminClientWithCount(2);
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );
      mock.from
        .mockReturnValueOnce(qb(invitation))
        .mockReturnValueOnce(qb({ id: 'org-1', name: 'Test Org' }))
        .mockReturnValueOnce(qb({ organization_id: 'org-1' }))
        .mockReturnValueOnce(qb(null))
        .mockReturnValue(qb(null));

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(true);
      expect(limitsResolver.checkOrgLimit).toHaveBeenCalledWith('org-1', 'max_students', 2);
    });

    it('returns a DB failure when the member count cannot be read', async () => {
      const c: any = {};
      c.select = vi.fn(() => c);
      c.eq = vi.fn().mockResolvedValue({ count: null, error: { message: 'boom', code: 'XX000' } });
      service = new InvitationService(
        async () => mock as any,
        () => ({ from: () => c }) as any,
      );
      mock.from.mockReturnValueOnce(qb(invitation));

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(false);
      expect(limitsResolver.checkOrgLimit).not.toHaveBeenCalled();
    });
  });
});
