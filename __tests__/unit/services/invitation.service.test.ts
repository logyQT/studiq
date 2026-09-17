import { AccountType, RequestContext } from '@studiq/authz';
import { InvitationService } from '@studiq/server/services/invitation.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/services/limits.resolver', () => ({
  limitsResolver: { checkLimit: vi.fn().mockResolvedValue(undefined) },
}));

function qb(data: any, error: any = null) {
  const result = { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
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
});
