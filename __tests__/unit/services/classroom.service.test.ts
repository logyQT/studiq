import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { ClassroomService } from '@/server/services/classroom.service';
import type { RequestContext } from '@/lib/request-context';

function qb(data: any, error: any = null) {
  const promise = Promise.resolve({ data: data ?? null, error });
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.maybeSingle = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('ClassroomService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: ClassroomService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: 'student' as any,
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
    service = new ClassroomService(async () => mock as any);
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
