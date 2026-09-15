import { RequestContext } from '@studiq/authz';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { OrgService } from '@/server/services/org.service';

function qb(data: any, error: any = null) {
  const promise = Promise.resolve({ data: data ?? null, error });
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.maybeSingle = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('OrgService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: OrgService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: 'student' as any,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: 'org-1',
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new OrgService(async () => mock as any);
  });

  describe('listOrgs', () => {
    it('returns orgs for user', async () => {
      const memberships = [
        {
          organization_id: 'org-1',
          org_role_id: 'r-1',
          org_roles: [{ name: 'admin', display_name: 'Admin' }],
        },
      ];
      const orgs = [{ id: 'org-1', name: 'Test Org' }];
      mock.from.mockReturnValueOnce(qb(memberships));
      mock.from.mockReturnValueOnce(qb(orgs));

      const result = await service.listOrgs(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Test Org');
    });

    it('returns empty when no memberships', async () => {
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listOrgs(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('returns error on membership query failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.listOrgs(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('returns error on org query failure', async () => {
      const memberships = [
        { organization_id: 'org-1', org_role_id: 'r-1', org_roles: [{ name: 'admin' }] },
      ];
      mock.from.mockReturnValueOnce(qb(memberships));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.listOrgs(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('verifyMembership', () => {
    it('returns membership when found', async () => {
      mock.from.mockReturnValueOnce(qb({ organization_id: 'org-1' }));

      const result = await service.verifyMembership('user-1', 'org-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ organization_id: 'org-1' });
    });

    it('returns NOT_FOUND when not a member', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.verifyMembership('user-1', 'org-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.verifyMembership('user-1', 'org-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });
});
