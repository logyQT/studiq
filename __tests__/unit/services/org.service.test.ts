import { AccountType, type RequestContext } from '@studiq/authz';
import { OrgService } from '@studiq/server/services/org.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

type ChainMock = ReturnType<typeof vi.fn>;

/** A thenable PostgREST builder stand-in: every chain method returns itself. */
interface QueryBuilder {
  select: ChainMock;
  insert: ChainMock;
  update: ChainMock;
  delete: ChainMock;
  eq: ChainMock;
  in: ChainMock;
  order: ChainMock;
  single: ChainMock;
  maybeSingle: ChainMock;
  then: ChainMock;
  catch: ChainMock;
  finally: ChainMock;
}

const CHAIN_METHODS = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order'] as const;

function qb(data: unknown, error: unknown = null): QueryBuilder {
  const result = { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const builder = {} as QueryBuilder;
  for (const method of CHAIN_METHODS) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn().mockResolvedValue(result);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.then = vi.fn(promise.then.bind(promise));
  builder.catch = vi.fn(promise.catch.bind(promise));
  builder.finally = vi.fn(promise.finally.bind(promise));
  return builder;
}

describe('OrgService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: OrgService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.STUDENT,
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
    service = new OrgService(async () => mock);
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

    it('surfaces org branding fields for the navbar (issue #108)', async () => {
      const memberships = [
        {
          organization_id: 'org-1',
          org_role_id: 'r-1',
          org_roles: [{ name: 'admin', display_name: 'Admin' }],
        },
      ];
      const orgs = [
        {
          id: 'org-1',
          name: 'Branded Org',
          logo_url: 'https://cdn.example.com/logo.png',
          brand_color: '#FF6600',
        },
      ];
      mock.from.mockReturnValueOnce(qb(memberships));
      mock.from.mockReturnValueOnce(qb(orgs));

      const result = await service.listOrgs(ctx);

      expect(result.success).toBe(true);
      expect(result.data[0].logo_url).toBe('https://cdn.example.com/logo.png');
      expect(result.data[0].brand_color).toBe('#FF6600');
    });

    it('defaults branding fields to null when the org has none set', async () => {
      const memberships = [
        {
          organization_id: 'org-1',
          org_role_id: 'r-1',
          org_roles: [{ name: 'admin', display_name: 'Admin' }],
        },
      ];
      const orgs = [{ id: 'org-1', name: 'Plain Org', logo_url: null, brand_color: null }];
      mock.from.mockReturnValueOnce(qb(memberships));
      mock.from.mockReturnValueOnce(qb(orgs));

      const result = await service.listOrgs(ctx);

      expect(result.success).toBe(true);
      expect(result.data[0].logo_url).toBeNull();
      expect(result.data[0].brand_color).toBeNull();
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
