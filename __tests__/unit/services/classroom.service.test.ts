import { AccountType, type RequestContext } from '@studiq/authz';
import { ClassroomService } from '@studiq/server/services/classroom.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

type QueryResult = { data: unknown; error: unknown };
type QueryChain = {
  select: Mock<(...args: unknown[]) => QueryChain>;
  insert: Mock<(...args: unknown[]) => QueryChain>;
  update: Mock<(...args: unknown[]) => QueryChain>;
  delete: Mock<(...args: unknown[]) => QueryChain>;
  eq: Mock<(...args: unknown[]) => QueryChain>;
  order: Mock<(...args: unknown[]) => QueryChain>;
  single: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  maybeSingle: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  then: Promise<QueryResult>['then'];
  catch: Promise<QueryResult>['catch'];
  finally: Promise<QueryResult>['finally'];
};

function qb(data: unknown, error: unknown = null) {
  const promise = Promise.resolve<QueryResult>({ data: data ?? null, error });
  const b: QueryChain = {
    select: vi.fn(() => b),
    insert: vi.fn(() => b),
    update: vi.fn(() => b),
    delete: vi.fn(() => b),
    eq: vi.fn(() => b),
    order: vi.fn(() => b),
    single: vi.fn().mockResolvedValue({ data: data ?? null, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data: data ?? null, error }),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return b;
}

describe('ClassroomService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: ClassroomService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.STUDENT,
    traceId: 'test',
    url: '',
    method: 'POST',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new ClassroomService(() => mock);
  });

  describe('create', () => {
    it('creates a classroom with admin role', async () => {
      const org = { id: 'org-1', name: 'Classroom 1' };
      const adminRole = { id: 'role-admin' };
      mock.from.mockReturnValueOnce(qb(org));
      mock.from.mockReturnValueOnce(qb(adminRole));
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.create(ctx, { name: 'Classroom 1' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ ...org, adminRoleId: 'role-admin' });
    });

    it('returns error on org insert failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.create(ctx, { name: 'Classroom 1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('returns INTERNAL_SERVER when admin role not found', async () => {
      const org = { id: 'org-1', name: 'Classroom 1' };
      mock.from.mockReturnValueOnce(qb(org));
      mock.from.mockReturnValueOnce(qb(null, null));
      // Cleanup delete
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.create(ctx, { name: 'Classroom 1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('returns error on member insert failure', async () => {
      const org = { id: 'org-1', name: 'Classroom 1' };
      const adminRole = { id: 'role-admin' };
      mock.from.mockReturnValueOnce(qb(org));
      mock.from.mockReturnValueOnce(qb(adminRole));
      mock.from.mockReturnValueOnce(qb(null, { message: 'FK violation' }));
      // Cleanup delete
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.create(ctx, { name: 'Classroom 1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });
});
