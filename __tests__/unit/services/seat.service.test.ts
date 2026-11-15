import type { RequestContext } from '@studiq/authz';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { MAX_SEAT_POOL_TOTAL } from '@studiq/server/models/seat.model';
import { SeatService } from '@studiq/server/services/seat.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

type QueryResult = { data: unknown; error: unknown; count?: number };
type QueryChain = {
  select: Mock<(...args: unknown[]) => QueryChain>;
  eq: Mock<(...args: unknown[]) => QueryChain>;
  in: Mock<(...args: unknown[]) => QueryChain>;
  or: Mock<(...args: unknown[]) => QueryChain>;
  order: Mock<(...args: unknown[]) => QueryChain>;
  filter: Mock<(...args: unknown[]) => QueryChain>;
  limit: Mock<(...args: unknown[]) => QueryChain>;
  single: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  maybeSingle: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  insert: Mock<(...args: unknown[]) => QueryChain>;
  update: Mock<(...args: unknown[]) => QueryChain>;
  delete: Mock<(...args: unknown[]) => QueryChain>;
  upsert: Mock<(...args: unknown[]) => QueryChain>;
  then: Promise<QueryResult>['then'];
};

function chain(result: unknown, count?: number, error: unknown = null) {
  const resolved: QueryResult =
    count !== undefined ? { data: result, count, error } : { data: result, error };
  const promise = Promise.resolve(resolved);
  const terminal = vi.fn().mockResolvedValue(resolved);
  const c: QueryChain = {
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
  const service = new SeatService(() => Promise.resolve(mock));

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

  describe('addPool', () => {
    const input = { planKey: 'campus', quantity: 5 };

    it('creates a pool when none exists for the plan', async () => {
      const read = chain(null);
      const write = chain({ id: 'pool-1', plan_key: 'campus', total: 5, assigned: 0 });
      mock.from.mockReturnValueOnce(read).mockReturnValueOnce(write);

      const result = await service.addPool(ctx, input);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toEqual({ id: 'pool-1', planKey: 'campus', total: 5, assigned: 0 });
      expect(write.insert).toHaveBeenCalledWith({
        organization_id: orgId,
        plan_key: 'campus',
        total: 5,
      });
      expect(write.update).not.toHaveBeenCalled();
    });

    it('increments an existing pool', async () => {
      const read = chain({ id: 'pool-1', total: 5 });
      const write = chain({ id: 'pool-1', plan_key: 'campus', total: 8, assigned: 0 });
      mock.from.mockReturnValueOnce(read).mockReturnValueOnce(write);

      const result = await service.addPool(ctx, { planKey: 'campus', quantity: 3 });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.total).toBe(8);
      expect(write.update).toHaveBeenCalledWith({ total: 8 });
    });

    it('accepts an increment that lands exactly on the int4 bound', async () => {
      const read = chain({ id: 'pool-1', total: 5 });
      const write = chain({
        id: 'pool-1',
        plan_key: 'campus',
        total: MAX_SEAT_POOL_TOTAL,
        assigned: 0,
      });
      mock.from.mockReturnValueOnce(read).mockReturnValueOnce(write);

      const result = await service.addPool(ctx, {
        planKey: 'campus',
        quantity: MAX_SEAT_POOL_TOTAL - 5,
      });

      expect(result.success).toBe(true);
      expect(write.update).toHaveBeenCalledWith({ total: MAX_SEAT_POOL_TOTAL });
    });

    it('rejects an increment that would overflow int4 without writing (#266)', async () => {
      const read = chain({ id: 'pool-1', total: 5 });
      mock.from.mockReturnValueOnce(read);

      const result = await service.addPool(ctx, {
        planKey: 'campus',
        quantity: MAX_SEAT_POOL_TOTAL,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(result.details?.[0]?.message).toBe(ValidationErrorCode.TOO_BIG);
      expect(result.details?.[0]?.path).toEqual(['quantity']);
      // No write attempt: a second table call would have no mock and throw.
      expect(read.update).not.toHaveBeenCalled();
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('returns FORBIDDEN when no activeOrgId', async () => {
      const noOrgCtx = { ...ctx, activeOrgId: null };

      const result = await service.addPool(noOrgCtx, input);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('FORBIDDEN');
    });

    it('refuses an unmapped plan_key before writing (#1145)', async () => {
      // `assignSeat` refuses such a pool, so creating it only stores a row that
      // can never hold a seat.
      const result = await service.addPool(ctx, { planKey: 'not-a-plan', quantity: 2 });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(result.details?.[0]?.message).toBe(ValidationErrorCode.INVALID_INPUT);
      expect(result.details?.[0]?.path).toEqual(['planKey']);
      expect(mock.from).not.toHaveBeenCalled();
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

    it('refuses a total below the assigned count as 422, not a DB error (#1068)', async () => {
      // The table's check constraint is the enforcement point: the write is
      // atomic with it, so a concurrent assignment cannot slip through.
      const write = chain(null, undefined, {
        code: '23514',
        message:
          'new row for relation "org_seat_pools" violates check constraint "org_seat_pools_total_not_below_assigned"',
      });
      mock.from.mockReturnValueOnce(write);

      const result = await service.updatePool(ctx, 'pool-1', { total: 0 });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(result.details?.[0]?.message).toBe(ValidationErrorCode.TOO_SMALL);
      expect(result.details?.[0]?.path).toEqual(['total']);
      expect(write.update).toHaveBeenCalledWith({ total: 0 });
    });

    it('keeps an unrelated check violation a generic 400, not "total too small" (#1145)', async () => {
      // A second CHECK on the table would report the same SQLSTATE; narrowing by
      // constraint name keeps the 422 meaning the assigned-count floor only.
      const write = chain(null, undefined, {
        code: '23514',
        message:
          'new row for relation "org_seat_pools" violates check constraint "org_seat_pools_some_other_check"',
      });
      mock.from.mockReturnValueOnce(write);

      const result = await service.updatePool(ctx, 'pool-1', { total: 0 });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('BAD_REQUEST');
      expect(result.details).toBeUndefined();
    });

    it('accepts a total equal to the assigned count', async () => {
      const write = chain({ id: 'pool-1', plan_key: 'pro', total: 3, assigned: 3 });
      mock.from.mockReturnValueOnce(write);

      const result = await service.updatePool(ctx, 'pool-1', { total: 3 });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toEqual({ id: 'pool-1', planKey: 'pro', total: 3, assigned: 3 });
      expect(write.update).toHaveBeenCalledWith({ total: 3 });
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
      mock.from.mockReturnValueOnce(chain(null, undefined, { message: 'DB error', code: 'XXX' }));

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
      expect(result.data[0]?.userFullName).toBeNull();
    });

    it('keeps an assignment whose profile is hidden by RLS (orphaned seat)', async () => {
      // `profiles` is RLS-narrowed to the caller's own row and to users who
      // share an organization. An assignment left behind by a removed member
      // must still be listed (#191 review-2-r3 B2) with an empty email/name so
      // the manager can unassign it; the embed is a left join.
      const dbRows = [
        {
          id: 'assign-orphan',
          user_id: 'user-orphan',
          pool_id: 'pool-1',
          assigned_at: '2024-01-01T00:00:00Z',
          pool: { plan_key: 'pro' },
          profile: null,
        },
      ];

      mock.from.mockReturnValue(chain(dbRows));

      const result = await service.listAssignments(ctx);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toEqual([
        {
          id: 'assign-orphan',
          userId: 'user-orphan',
          poolId: 'pool-1',
          planKey: 'pro',
          userEmail: '',
          userFullName: null,
          assignedAt: '2024-01-01T00:00:00Z',
        },
      ]);
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

    it('refuses a pool whose plan has no seat tier (#1068)', async () => {
      // An unmapped plan key means the tier cannot be checked. Skipping the
      // check is the fail-open path: refuse instead, before any profile read.
      mock.from.mockReturnValueOnce(chain({ id: 'pool-1', plan_key: 'not-a-plan' }));

      const result = await service.assignSeat(ctx, input);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('BAD_REQUEST');
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('refuses a mismatched tier when the member lookup errors (#1068)', async () => {
      mock.from.mockReturnValueOnce(chain({ id: 'pool-1', plan_key: 'pro' }));
      mock.from.mockReturnValueOnce(chain({ email: 'teacher@test.com' }));
      mock.from.mockReturnValueOnce(
        chain(null, undefined, { message: 'member lookup failed', code: 'XXX' }),
      );

      const result = await service.assignSeat(ctx, input);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('INTERNAL_SERVER');
      expect(mock.from).toHaveBeenCalledTimes(3);
    });

    it('reads a one-element org_roles embed and refuses the mismatched tier (#1068)', async () => {
      mock.from.mockReturnValueOnce(chain({ id: 'pool-1', plan_key: 'pro' }));
      mock.from.mockReturnValueOnce(chain({ email: 'teacher@test.com' }));
      mock.from.mockReturnValueOnce(chain({ org_roles: [{ name: 'teacher' }] }));

      const result = await service.assignSeat(ctx, input);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('BAD_REQUEST');
      expect(mock.from).toHaveBeenCalledTimes(3);
    });

    it('assigns a matching member whose org_roles embed arrives as a one-element array (#1068)', async () => {
      // The array shape must resolve to the member's tier, not to `undefined`:
      // reading `.name` off the array refuses a legitimate seat.
      mock.from.mockReturnValueOnce(chain({ id: 'pool-1', plan_key: 'pro' }));
      mock.from.mockReturnValueOnce(chain({ email: 'member@test.com' }));
      mock.from.mockReturnValueOnce(chain({ org_roles: [{ name: 'member' }] }));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce(
        chain({
          id: 'assign-new',
          user_id: input.userId,
          pool_id: input.poolId,
          assigned_at: '2024-01-01T00:00:00Z',
        }),
      );

      const result = await service.assignSeat(ctx, input);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.planKey).toBe('pro');
      expect(result.data.userId).toBe(input.userId);
    });

    it('refuses a member whose org role has no seat tier', async () => {
      mock.from.mockReturnValueOnce(chain({ id: 'pool-1', plan_key: 'pro' }));
      mock.from.mockReturnValueOnce(chain({ email: 'assistant@test.com' }));
      mock.from.mockReturnValueOnce(chain({ org_roles: { name: 'assistant' } }));

      const result = await service.assignSeat(ctx, input);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('BAD_REQUEST');
      expect(mock.from).toHaveBeenCalledTimes(3);
    });

    it('assigns to a target with no org membership (no role tier to contradict)', async () => {
      // Seat features resolve through org membership, so this seat is inert
      // until the target joins — the code base allows staging one.
      mock.from.mockReturnValueOnce(chain({ id: 'pool-1', plan_key: 'pro' }));
      mock.from.mockReturnValueOnce(chain({ email: 'outsider@test.com' }));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce(chain(null));
      mock.from.mockReturnValueOnce(
        chain({
          id: 'assign-new',
          user_id: input.userId,
          pool_id: input.poolId,
          assigned_at: '2024-01-01T00:00:00Z',
        }),
      );

      const result = await service.assignSeat(ctx, input);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.planKey).toBe('pro');
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

    it('returns USAGE_LIMIT_EXCEEDED when pool full (code 23514 with an unrelated message)', async () => {
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
              error: { code: '23514', message: 'new row violates check constraint' },
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
