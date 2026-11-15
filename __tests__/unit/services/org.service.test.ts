import { AccountType, type RequestContext } from '@studiq/authz';
import type { ServiceResult } from '@studiq/server/lib/service-result';
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
  const builder: QueryBuilder = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn(promise.then.bind(promise)),
    catch: vi.fn(promise.catch.bind(promise)),
    finally: vi.fn(promise.finally.bind(promise)),
  };
  for (const method of CHAIN_METHODS) {
    builder[method].mockReturnValue(builder);
  }
  return builder;
}

/** Narrows a service result to its data, failing the test when the call failed. */
function expectSuccess<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new Error(`expected success, got ${result.error}`);
  return result.data;
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
    service = new OrgService(() => Promise.resolve(mock));
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
      expect(expectSuccess(result)).toHaveLength(1);
      expect(expectSuccess(result)[0]?.name).toBe('Test Org');
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
      expect(expectSuccess(result)[0]?.logo_url).toBe('https://cdn.example.com/logo.png');
      expect(expectSuccess(result)[0]?.brand_color).toBe('#FF6600');
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
      expect(expectSuccess(result)[0]?.logo_url).toBeNull();
      expect(expectSuccess(result)[0]?.brand_color).toBeNull();
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
