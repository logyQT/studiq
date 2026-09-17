import { RequestContext } from '@studiq/authz';
import { SeatService } from '@studiq/server/services/seat.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function chain(result: any, count?: number) {
  const resolved =
    count !== undefined ? { data: result, count, error: null } : { data: result, error: null };
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

describe('SeatService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  const orgId = '00000000-0000-4000-8000-000000000001';
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: 'manager',
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: orgId,
    orgRoleId: 'role-id',
    groupIds: [],
    permissionScopes: {},
  };
  const service = new SeatService(async () => mock as any);

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('listPools', () => {
    it('returns pools for active org', async () => {
      const dbRows = [{ id: 'pool-1', plan_key: 'launch', total: 1, assigned: 0 }];

      mock.from.mockReturnValue(chain(dbRows));

      const result = await service.listPools(ctx);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        id: 'pool-1',
        planKey: 'launch',
        total: 1,
        assigned: 0,
      });
      expect(mock.from).toHaveBeenCalledWith('org_seat_pools');
    });

    it('returns empty array when no pools', async () => {
      mock.from.mockReturnValue(chain([]));

      const result = await service.listPools(ctx);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toEqual([]);
    });

    it('returns FORBIDDEN when no activeOrgId', async () => {
      const noOrgCtx = { ...ctx, activeOrgId: null };

      const result = await service.listPools(noOrgCtx);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns INTERNAL_SERVER on DB error', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'DB error', code: 'XXX' },
            }),
          }),
        }),
      });

      const result = await service.listPools(ctx);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('updatePool', () => {
    it('updates total and returns pool', async () => {
      const dbRow = { id: 'pool-1', plan_key: 'launch', total: 10, assigned: 0 };

      mock.from.mockReturnValue(chain(dbRow));

      const result = await service.updatePool(ctx, 'pool-1', { total: 10 });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toEqual({
        id: 'pool-1',
        planKey: 'launch',
        total: 10,
        assigned: 0,
      });
    });

    it('returns NOT_FOUND when pool does not exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.updatePool(ctx, 'nonexistent', { total: 5 });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns FORBIDDEN when no activeOrgId', async () => {
      const noOrgCtx = { ...ctx, activeOrgId: null };

      const result = await service.updatePool(noOrgCtx, 'pool-1', { total: 5 });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns INTERNAL_SERVER on DB error', async () => {
      mock.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'DB error', code: 'XXX' },
                }),
              }),
            }),
          }),
        }),
      });

      const result = await service.updatePool(ctx, 'pool-1', { total: 5 });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('listAssignments', () => {
    it('returns assignments with plan and profile data', async () => {
      const dbRows = [
        {
          id: 'assign-1',
          user_id: 'user-1',
          pool_id: 'pool-1',
          assigned_at: '2024-01-01T00:00:00Z',
          pool: { plan_key: 'launch' },
          profile: { email: 'user@test.com', full_name: 'User One' },
        },
      ];

      mock.from.mockReturnValue(chain(dbRows));

      const result = await service.listAssignments(ctx);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        id: 'assign-1',
        userId: 'user-1',
        poolId: 'pool-1',
        planKey: 'launch',
        userEmail: 'user@test.com',
        userFullName: 'User One',
        assignedAt: '2024-01-01T00:00:00Z',
      });
    });

    it('returns empty array when no assignments', async () => {
      mock.from.mockReturnValue(chain([]));

      const result = await service.listAssignments(ctx);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toEqual([]);
    });

    it('handles nullable full_name', async () => {
      const dbRows = [
        {
          id: 'assign-2',
          user_id: 'user-2',
          pool_id: 'pool-1',
          assigned_at: '2024-01-01T00:00:00Z',
          pool: { plan_key: 'launch' },
          profile: { email: 'anon@test.com', full_name: null },
        },
      ];

      mock.from.mockReturnValue(chain(dbRows));

      const result = await service.listAssignments(ctx);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data[0].userFullName).toBeNull();
    });

    it('returns FORBIDDEN when no activeOrgId', async () => {
      const noOrgCtx = { ...ctx, activeOrgId: null };

      const result = await service.listAssignments(noOrgCtx);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('FORBIDDEN');
    });
  });

  describe('assignSeat', () => {
    const input = {
      userId: 'user-to-assign',
      poolId: 'pool-1',
    };

    it('assigns seat and returns assignment', async () => {
      const poolRow = { id: 'pool-1', plan_key: 'guide' };
      const profileRow = { email: 'user@test.com' };
      const memberRow = { org_roles: { name: 'teacher' } };
      const insertedRow = {
        id: 'assign-new',
        user_id: input.userId,
        pool_id: input.poolId,
        assigned_at: '2024-01-01T00:00:00Z',
      };

      mock.from.mockReturnValue(chain(null));
      mock.from.mockReturnValueOnce(chain(poolRow));
      mock.from.mockReturnValueOnce(chain(profileRow));
      mock.from.mockReturnValueOnce(chain(memberRow));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce(chain(insertedRow));

      const result = await service.assignSeat(ctx, input);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toEqual({
        id: 'assign-new',
        userId: input.userId,
        poolId: input.poolId,
        planKey: 'guide',
        userEmail: 'user@test.com',
        assignedAt: '2024-01-01T00:00:00Z',
      });
    });

    it('returns NOT_FOUND when pool does not match org', async () => {
      mock.from.mockReturnValue(chain(null));
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.assignSeat(ctx, input);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when user does not exist', async () => {
      mock.from.mockReturnValue(chain(null));
      mock.from.mockReturnValueOnce(chain({ id: 'pool-1', plan_key: 'launch' }));
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.assignSeat(ctx, input);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns USAGE_LIMIT_EXCEEDED when user already has a seat', async () => {
      mock.from.mockReturnValue(chain(null));
      mock.from.mockReturnValueOnce(chain({ id: 'pool-1', plan_key: 'guide' }));
      mock.from.mockReturnValueOnce(chain({ email: 'user@test.com' }));
      mock.from.mockReturnValueOnce(chain({ org_roles: { name: 'teacher' } }));
      mock.from.mockReturnValueOnce(chain({ id: 'existing-assign' }));

      const result = await service.assignSeat(ctx, input);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('USAGE_LIMIT_EXCEEDED');
    });

    it('returns USAGE_LIMIT_EXCEEDED when pool is full (SEAT_POOL_FULL)', async () => {
      mock.from.mockReturnValue(chain(null));
      mock.from.mockReturnValueOnce(chain({ id: 'pool-1', plan_key: 'guide' }));
      mock.from.mockReturnValueOnce(chain({ email: 'user@test.com' }));
      mock.from.mockReturnValueOnce(chain({ org_roles: { name: 'teacher' } }));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'SEAT_POOL_FULL', code: '23514' },
            }),
          }),
        }),
      });

      const result = await service.assignSeat(ctx, input);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('USAGE_LIMIT_EXCEEDED');
    });

    it('returns USAGE_LIMIT_EXCEEDED when pool full (code 23514 without message)', async () => {
      mock.from.mockReturnValue(chain(null));
      mock.from.mockReturnValueOnce(chain({ id: 'pool-1', plan_key: 'guide' }));
      mock.from.mockReturnValueOnce(chain({ email: 'user@test.com' }));
      mock.from.mockReturnValueOnce(chain({ org_roles: { name: 'teacher' } }));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '23514' },
            }),
          }),
        }),
      });

      const result = await service.assignSeat(ctx, input);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('USAGE_LIMIT_EXCEEDED');
    });

    it('returns FORBIDDEN when no activeOrgId', async () => {
      const noOrgCtx = { ...ctx, activeOrgId: null };

      const result = await service.assignSeat(noOrgCtx, input);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('FORBIDDEN');
    });
  });

  describe('unassignSeat', () => {
    it('deletes assignment successfully', async () => {
      mock.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      const result = await service.unassignSeat(ctx, 'assign-1');

      expect(result.success).toBe(true);
    });

    it('returns FORBIDDEN when no activeOrgId', async () => {
      const noOrgCtx = { ...ctx, activeOrgId: null };

      const result = await service.unassignSeat(noOrgCtx, 'assign-1');

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('FORBIDDEN');
    });
  });
});
