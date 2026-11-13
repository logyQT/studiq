import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { json } from '#test/helpers/json';
import { createSeedDb } from '#test/helpers/tenant-seed';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  useRealSupabase,
  cleanupOrganizationDeep,
  mockUser,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import { DELETE as deleteAssignment } from '@/app/(backend)/api/v1/organization/seats/assignments/[id]/route';
import {
  POST as createAssignment,
  GET as getAssignments,
} from '@/app/(backend)/api/v1/organization/seats/assignments/route';
import { PUT as updatePool } from '@/app/(backend)/api/v1/organization/seats/pools/[id]/route';
import {
  POST as createPool,
  GET as getPools,
} from '@/app/(backend)/api/v1/organization/seats/pools/route';

/** Seat pool resource of `/organization/seats/pools` — the fields read below. */
interface SeatPool {
  id: string;
  planKey: string;
  total: number;
  assigned: number;
}

/** Single pool payload (`{ success, data }`). */
type PoolBody = { success: boolean; data: SeatPool };

/** Pool list payload. */
type PoolListBody = { success: boolean; data: SeatPool[] };

/** Seat assignment resource — the fields read below. */
interface SeatAssignment {
  id: string;
  userId: string;
  poolId: string;
}

/** Assignment list payload. */
type AssignmentListBody = { success: boolean; data: SeatAssignment[] };

/** Single assignment payload. */
type AssignmentBody = { success: boolean; data: SeatAssignment };

/** Error envelope (`{ success: false, error, issues }`) of the routes under test. */
interface SeatsErrorBody {
  success: boolean;
  error?: string;
  issues?: { properties: Partial<Record<'quantity' | 'total', { errors: string[] }>> };
}

describe(`Seats Integration`, () => {
  let fixture!: BeforeResult;
  let orgId!: string;
  let poolId!: string;
  let assigneeA!: TestUserFixture;
  let assigneeB!: TestUserFixture;
  let assigneeC!: TestUserFixture;
  let student!: TestUserFixture;

  const orgCookies = () => ({ active_org_id: orgId });

  beforeAll(async () => {
    // Manager creates the org via the API (launch plan by default).
    fixture = await before({ role: 'manager', org: true });
    orgId = fixture.orgId!;

    // Create a pool via the API (no default pools after S1).
    // Use 'guide' plan (educator tier) for educator-role test users.
    mockUser(fixture.user);
    const createReq = createNextRequest(
      'http://localhost/api/v1/organization/seats/pools',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey: 'guide', quantity: 10 }),
      },
      orgCookies(),
    );
    const createRes = await createPool(createReq);
    const createBody = await json<PoolBody>(createRes);
    poolId = createBody.data.id;

    // Unique assignee users per suite run (org_seat_assignments
    // has a UNIQUE(organization_id, user_id) constraint).
    assigneeA = await createTestUser({ role: 'educator' });
    assigneeB = await createTestUser({ role: 'educator' });
    assigneeC = await createTestUser({ role: 'educator' });
    student = await createTestUser({ role: 'student' });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  afterAll(async () => {
    if (orgId) {
      await cleanupOrganizationDeep(orgId);
    }
  });

  describe('GET /pools', () => {
    it('returns seat pools for the org', async () => {
      mockUser(fixture.user);

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        undefined,
        orgCookies(),
      );

      const response = await getPools(req);
      const body = await json<PoolListBody>(response);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThanOrEqual(1);

      const pool = body.data.find((p) => p.planKey === 'guide');
      expect(pool).toBeDefined();
      expect(pool!.total).toBe(10);
      expect(pool!.assigned).toBe(0);
    });

    it('returns 403 for non-manager users', async () => {
      mockUser(student);

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        undefined,
        orgCookies(),
      );

      const response = await getPools(req);
      const body = await json<SeatsErrorBody>(response);

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error).toBe('FORBIDDEN');
    });
  });

  describe('POST /pools', () => {
    it('creates a new pool', async () => {
      mockUser(fixture.user);

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: 'ace', quantity: 5 }),
        },
        orgCookies(),
      );

      const response = await createPool(req);
      const body = await json<PoolBody>(response);

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.planKey).toBe('ace');
      expect(body.data.total).toBe(5);
    });

    it('increments existing pool on duplicate plan_key', async () => {
      mockUser(fixture.user);

      // Create second pool with same plan_key
      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: 'ace', quantity: 3 }),
        },
        orgCookies(),
      );

      const response = await createPool(req);
      const body = await json<PoolBody>(response);

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.total).toBe(8); // 5 + 3
    });
  });

  describe('PUT /pools/[id]', () => {
    it('updates pool total', async () => {
      mockUser(fixture.user);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/organization/seats/pools/${poolId}`,
        { id: poolId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ total: 5 }),
        },
        orgCookies(),
      );

      const response = await updatePool(request, { params });
      const body = await json<PoolBody>(response);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.total).toBe(5);
    });

    it('returns 422 when total is negative', async () => {
      mockUser(fixture.user);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/organization/seats/pools/${poolId}`,
        { id: poolId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ total: -1 }),
        },
        orgCookies(),
      );

      const response = await updatePool(request, { params });
      const body = await json<SeatsErrorBody>(response);

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 422 and keeps the pool when total would drop below assigned (#1068)', async () => {
      mockUser(fixture.user);
      const supabase = createSeedDb();
      const { error: seatError } = await supabase
        .from('org_seat_assignments')
        .insert({ organization_id: orgId, pool_id: poolId, user_id: assigneeC.id });
      expect(seatError).toBeNull();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/organization/seats/pools/${poolId}`,
        { id: poolId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ total: 0 }),
        },
        orgCookies(),
      );

      const response = await updatePool(request, { params });
      const body = await json<SeatsErrorBody>(response);

      expect(response.status).toBe(422);
      expect(body.issues!.properties.total!.errors).toContain('VALIDATION_INVALID_TOO_SMALL');
      const pool = await supabase
        .from('org_seat_pools')
        .select('total, assigned')
        .eq('id', poolId)
        .single();
      expect(pool.data).toEqual({ total: 5, assigned: 1 });

      await supabase
        .from('org_seat_assignments')
        .delete()
        .eq('organization_id', orgId)
        .eq('user_id', assigneeC.id);
    });
  });

  const readPools = async () => {
    const req = createNextRequest(
      'http://localhost/api/v1/organization/seats/pools',
      undefined,
      orgCookies(),
    );
    const response = await getPools(req);
    const body = await json<PoolListBody>(response);
    return body.data;
  };

  describe('Seat quantity bounds (#266)', () => {
    const INT4_MAX = 2_147_483_647;

    it('returns 422 (not 500) for a quantity above the int4 range and writes nothing', async () => {
      mockUser(fixture.user);

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: 'campus', quantity: 99_999_999_999 }),
        },
        orgCookies(),
      );

      const response = await createPool(req);
      const body = await json<SeatsErrorBody>(response);

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(body.issues!.properties.quantity.errors).toContain('VALIDATION_INVALID_TOO_BIG');

      const pools = await readPools();
      expect(pools.find((p) => p.planKey === 'campus')).toBeUndefined();
    });

    it('rejects an increment that would overflow int4 and leaves the pool unchanged', async () => {
      mockUser(fixture.user);

      // Seed a small pool, then try to add int4-max on top of it.
      const seedReq = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: 'pro', quantity: 8 }),
        },
        orgCookies(),
      );
      const seedRes = await createPool(seedReq);
      expect(seedRes.status).toBe(201);

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: 'pro', quantity: INT4_MAX }),
        },
        orgCookies(),
      );

      const response = await createPool(req);
      const body = await json<SeatsErrorBody>(response);

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(body.issues!.properties.quantity.errors).toContain('VALIDATION_INVALID_TOO_BIG');

      const pools = await readPools();
      expect(pools.find((p) => p.planKey === 'pro')?.total).toBe(8);
    });

    it('returns 422 for a PUT above the int4 range and leaves the pool unchanged', async () => {
      mockUser(fixture.user);

      const beforeUpdate = (await readPools()).find((p) => p.id === poolId);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/organization/seats/pools/${poolId}`,
        { id: poolId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ total: 99_999_999_999 }),
        },
        orgCookies(),
      );

      const response = await updatePool(request, { params });
      const body = await json<SeatsErrorBody>(response);

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');

      const after = (await readPools()).find((p) => p.id === poolId);
      expect(after?.total).toBe(beforeUpdate?.total);
    });

    it('never stores a pool total above the int4 bound', async () => {
      mockUser(fixture.user);
      const pools = await readPools();
      for (const pool of pools) {
        expect(pool.total).toBeLessThanOrEqual(INT4_MAX);
      }
    });
  });

  describe('GET /assignments', () => {
    it('returns empty list initially', async () => {
      mockUser(fixture.user);

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/assignments',
        undefined,
        orgCookies(),
      );

      const response = await getAssignments(req);
      const body = await json<AssignmentListBody>(response);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data).toHaveLength(0);
    });
  });

  describe('POST /assignments', () => {
    it('creates an assignment', async () => {
      mockUser(fixture.user);

      const { request } = createNextRequestWithParams(
        'http://localhost/api/v1/organization/seats/assignments',
        {},
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: assigneeA.id, poolId }),
        },
        orgCookies(),
      );

      const response = await createAssignment(request);
      const body = await json<AssignmentBody>(response);

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe(assigneeA.id);
      expect(body.data.poolId).toBe(poolId);
    });

    it('succeeds and can be listed after creation', async () => {
      mockUser(fixture.user);

      // Create
      const createReq = createNextRequest(
        'http://localhost/api/v1/organization/seats/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: assigneeB.id, poolId }),
        },
        orgCookies(),
      );
      const createRes = await createAssignment(createReq);
      expect(createRes.status).toBe(201);

      // List — should appear
      const listReq = createNextRequest(
        'http://localhost/api/v1/organization/seats/assignments',
        undefined,
        orgCookies(),
      );
      const listRes = await getAssignments(listReq);
      const listBody = await json<AssignmentListBody>(listRes);

      expect(listBody.data.length).toBeGreaterThanOrEqual(1);
      const match = listBody.data.find((a) => a.userId === assigneeB.id);
      expect(match).toBeDefined();
      expect(match!.poolId).toBe(poolId);
    });

    it('returns 422 when fields missing', async () => {
      mockUser(fixture.user);

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
        orgCookies(),
      );

      const response = await createAssignment(req);
      const body = await json<SeatsErrorBody>(response);

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 400 and writes nothing when the member role tier does not match (#1068)', async () => {
      // `guide` is educator-tier: a member (student tier) must be refused even
      // though the pool has room.
      const supabase = createSeedDb();
      const memberRole = await supabase
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'member')
        .single();
      if (!memberRole.data) throw new Error('seed org is missing the member role');
      const studentMember = await createTestUser({ role: 'student' });
      await seedOrgMembership({
        organizationId: orgId,
        userId: studentMember.id,
        orgRoleId: memberRole.data.id,
      });
      mockUser(fixture.user);

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: studentMember.id, poolId }),
        },
        orgCookies(),
      );

      const response = await createAssignment(req);
      const body = await json<SeatsErrorBody>(response);

      expect(response.status).toBe(400);
      expect(body.error).toBe('BAD_REQUEST');
      const written = await supabase
        .from('org_seat_assignments')
        .select('id')
        .eq('organization_id', orgId)
        .eq('user_id', studentMember.id);
      expect(written.data).toEqual([]);
    });
  });

  describe('DELETE /assignments/[id]', () => {
    let assignmentId: string;

    beforeEach(async () => {
      // Seed an assignment to delete (use service role to bypass trigger)
      const supabase = createSeedDb();
      const { data: assignment } = await supabase
        .from('org_seat_assignments')
        .insert({
          organization_id: orgId,
          pool_id: poolId,
          user_id: assigneeC.id,
        })
        .select()
        .single();

      assignmentId = assignment?.id ?? '';
    });

    it('deletes an assignment', async () => {
      mockUser(fixture.user);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/organization/seats/assignments/${assignmentId}`,
        { id: assignmentId },
        { method: 'DELETE' },
        orgCookies(),
      );

      const response = await deleteAssignment(request, { params });
      const body = await json<{ success: boolean }>(response);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      // Verify deleted
      const listReq = createNextRequest(
        'http://localhost/api/v1/organization/seats/assignments',
        undefined,
        orgCookies(),
      );
      const listRes = await getAssignments(listReq);
      const listBody = await json<AssignmentListBody>(listRes);

      const match = listBody.data.find((a) => a.id === assignmentId);
      expect(match).toBeUndefined();
    });
  });

  describe('Hard block: pool capacity', () => {
    it('returns USAGE_LIMIT_EXCEEDED when pool is full', async () => {
      // A pool is full at `total = assigned`; `org_seat_pools_total_not_below_assigned`
      // forbids dropping it below that (#1068), so the fixture fills the pool.
      const supabase = createSeedDb();
      const assignedSeats = dbRows(
        (await supabase.from('org_seat_assignments').select('id').eq('organization_id', orgId))
          .data,
      );
      const { error: fillError } = await supabase
        .from('org_seat_pools')
        .update({ total: assignedSeats.length })
        .eq('id', poolId);
      expect(fillError).toBeNull();

      const newcomer = await createTestUser({ role: 'educator' });
      mockUser(fixture.user);

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: newcomer.id,
            poolId,
          }),
        },
        orgCookies(),
      );

      const response = await createAssignment(req);
      const body = await json<SeatsErrorBody>(response);

      expect(response.status).toBe(429);
      expect(body.success).toBe(false);
      expect(body.error).toBe('USAGE_LIMIT_EXCEEDED');
    });
  });
});
