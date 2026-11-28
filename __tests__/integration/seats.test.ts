import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import { createClient } from '@supabase/supabase-js';
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
  seedOrganization,
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
  issues?: {
    properties: Partial<Record<'quantity' | 'total' | 'planKey', { errors: string[] }>>;
  };
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

  /** Adds the user to the org with the member role; a seat needs a membership (#1146). */
  async function seedMember(userId: string) {
    const supabase = createSeedDb();
    const memberRole = await supabase
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    if (!memberRole.data) throw new Error('seed org is missing the member role');
    await seedOrgMembership({
      organizationId: orgId,
      userId,
      orgRoleId: memberRole.data.id,
    });
  }

  beforeAll(async () => {
    // Manager creates the org via the API (launch plan by default).
    fixture = await before({ role: 'manager', org: true });
    orgId = fixture.orgId!;

    // Create a pool via the API (no default pools after S1).
    // Use 'free' (Free) — a personal, seat-eligible plan — for the pool the
    // assignment tests share; the POST tests below buy `pro` fresh.
    mockUser(fixture.user);
    const createReq = createNextRequest(
      'http://localhost/api/v1/organization/seats/pools',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey: 'ai_lite', quantity: 10 }),
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

    // A seat is a per-member licence (#1146): every assignee is an org member.
    for (const assignee of [assigneeA, assigneeB, assigneeC, student]) {
      await seedMember(assignee.id);
    }
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

      const pool = body.data.find((p) => p.planKey === 'ai_lite');
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
          body: JSON.stringify({ planKey: 'ai_pro', quantity: 5 }),
        },
        orgCookies(),
      );

      const response = await createPool(req);
      const body = await json<PoolBody>(response);

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.planKey).toBe('ai_pro');
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
          body: JSON.stringify({ planKey: 'ai_pro', quantity: 3 }),
        },
        orgCookies(),
      );

      const response = await createPool(req);
      const body = await json<PoolBody>(response);

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.total).toBe(8); // 5 + 3
    });

    it('returns 422 for a plan_key with no seat tier and writes nothing (#1145)', async () => {
      mockUser(fixture.user);

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: 'not-a-plan', quantity: 2 }),
        },
        orgCookies(),
      );

      const response = await createPool(req);
      const body = await json<SeatsErrorBody>(response);

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(body.issues!.properties.planKey!.errors).toContain('VALIDATION_INVALID_INPUT');

      expect((await readPools()).find((p) => p.planKey === 'not-a-plan')).toBeUndefined();
    });

    it('refuses an organization-scope plan (campus) — a pool is a licence of a personal plan (D15/D32)', async () => {
      mockUser(fixture.user);

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: 'campus', quantity: 2 }),
        },
        orgCookies(),
      );

      const response = await createPool(req);
      const body = await json<SeatsErrorBody>(response);

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(body.issues!.properties.planKey!.errors).toContain('VALIDATION_INVALID_INPUT');

      expect((await readPools()).find((p) => p.planKey === 'campus')).toBeUndefined();
    });

    it('refuses a plan with a non-seat-eligible entitlement key, read from the live catalog (D33)', async () => {
      mockUser(fixture.user);
      const supabase = createSeedDb();
      const planKey = `test-seat-ineligible-${Date.now()}`;

      try {
        // Temporary fixture: an active personal plan carrying `branding`
        // (seat_eligible = false in entitlement_catalog).
        const { error: planError } = await supabase.from('subscription_plans').insert({
          key: planKey,
          name: 'Test seat-ineligible',
          price_monthly: 0,
          currency: 'PLN',
          sort_order: 990,
          is_active: true,
          scope: 'personal',
          visibility: 'unlisted',
          sales_channels: ['seat_pool'],
        });
        expect(planError).toBeNull();
        const { error: entError } = await supabase
          .from('plan_entitlements')
          .insert({ plan_key: planKey, entitlement_key: 'branding' });
        expect(entError).toBeNull();
        const limitRows = [
          'max_flashcards',
          'max_questions',
          'max_decks',
          'max_question_banks',
          'max_quiz_attempts_per_day',
          'max_ai_tokens_per_day',
          'max_students',
          'max_groups',
        ].map((limit_key) => ({ plan_key: planKey, limit_key, limit_value: 1 }));
        const { error: limError } = await supabase.from('plan_limits').insert(limitRows);
        expect(limError).toBeNull();

        const req = createNextRequest(
          'http://localhost/api/v1/organization/seats/pools',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ planKey, quantity: 2 }),
          },
          orgCookies(),
        );

        const response = await createPool(req);
        const body = await json<SeatsErrorBody>(response);

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
        expect(body.error).toBe('UNPROCESSABLE_ENTITY');
        expect(body.issues!.properties.planKey!.errors).toContain('VALIDATION_INVALID_INPUT');
        expect((await readPools()).find((p) => p.planKey === planKey)).toBeUndefined();
      } finally {
        await supabase.from('plan_limits').delete().eq('plan_key', planKey);
        await supabase.from('plan_entitlements').delete().eq('plan_key', planKey);
        await supabase.from('subscription_plans').delete().eq('key', planKey);
      }
    });

    it('accepts a licence plan whose keys are all seat-eligible (ai_pro)', async () => {
      mockUser(fixture.user);

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: 'ai_pro', quantity: 1 }),
        },
        orgCookies(),
      );

      const response = await createPool(req);
      const body = await json<PoolBody>(response);

      expect(response.status).toBe(201);
      expect(body.data.planKey).toBe('ai_pro');
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

      const totalBefore = (await readPools()).find((p) => p.planKey === 'ai_pro')?.total;

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: 'ai_pro', quantity: 99_999_999_999 }),
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
      expect(pools.find((p) => p.planKey === 'ai_pro')?.total).toBe(totalBefore);
    });

    it('rejects an increment that would overflow int4 and leaves the pool unchanged', async () => {
      mockUser(fixture.user);

      // Seed a small pool, then try to add int4-max on top of it.
      const seedReq = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: 'ai_max', quantity: 8 }),
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
          body: JSON.stringify({ planKey: 'ai_max', quantity: INT4_MAX }),
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
      expect(pools.find((p) => p.planKey === 'ai_max')?.total).toBe(8);
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

    it('returns 404 for a target who is not a member of the active org (#1146)', async () => {
      // A seat is a per-member licence: a profile row alone is not a licence
      // holder. The refusal is the same NOT_FOUND a missing user gets.
      mockUser(fixture.user);
      const outsider = await createTestUser({ role: 'student' });
      const supabase = createSeedDb();

      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: outsider.id, poolId }),
        },
        orgCookies(),
      );

      const response = await createAssignment(req);
      const body = await json<SeatsErrorBody>(response);

      expect(response.status).toBe(404);
      expect(body.error).toBe('NOT_FOUND');

      const written = await supabase
        .from('org_seat_assignments')
        .select('id')
        .eq('organization_id', orgId)
        .eq('user_id', outsider.id);
      expect(written.data).toEqual([]);
    });

    it('returns 404 for a member of another org that shares an org with the manager (#1146)', async () => {
      // The target is a real member elsewhere, so a lookup without the
      // active-org filter finds the row and writes the seat. The manager shares
      // that org, so the same lookup's profile embed is readable under the
      // `profiles` policy — the active-org filter is the only refusal left.
      mockUser(fixture.user);
      const supabase = createSeedDb();
      const otherOrg = await seedOrganization(`Seat other org ${Date.now()}`);
      const target = await createTestUser({ role: 'student' });

      try {
        await seedOrgMembership({
          organizationId: otherOrg.org.id,
          userId: target.id,
          orgRoleId: otherOrg.memberRoleId,
        });
        await seedOrgMembership({
          organizationId: otherOrg.org.id,
          userId: fixture.user.id,
          orgRoleId: otherOrg.memberRoleId,
        });

        const req = createNextRequest(
          'http://localhost/api/v1/organization/seats/assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: target.id, poolId }),
          },
          orgCookies(),
        );

        const response = await createAssignment(req);
        const body = await json<SeatsErrorBody>(response);

        expect(response.status).toBe(404);
        expect(body.error).toBe('NOT_FOUND');

        const written = await supabase
          .from('org_seat_assignments')
          .select('id')
          .eq('organization_id', orgId)
          .eq('user_id', target.id);
        expect(written.data).toEqual([]);
      } finally {
        await cleanupOrganizationDeep(otherOrg.org.id);
      }
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

    it('accepts a student account on a pool whose plan used to name another audience (#1193)', async () => {
      // `pro` used to be student-audience and the pool once required a matching
      // persona. A personal plan carries no audience now, so the student is
      // accepted when the pool has room.
      const supabase = createSeedDb();
      const studentMember = await createTestUser({ role: 'student' });
      await seedMember(studentMember.id);
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
      const body = await json<AssignmentBody>(response);

      expect(response.status).toBe(201);
      expect(body.data.userId).toBe(studentMember.id);
      const written = await supabase
        .from('org_seat_assignments')
        .select('id')
        .eq('organization_id', orgId)
        .eq('user_id', studentMember.id);
      expect(written.data).toHaveLength(1);
    });

    it('accepts an educator account on any personal-plan pool', async () => {
      const supabase = createSeedDb();
      mockUser(fixture.user);

      // A `max` pool (Max) — a valid licence for any member.
      const poolReq = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: 'ai_max', quantity: 2 }),
        },
        orgCookies(),
      );
      const poolRes = await createPool(poolReq);
      const poolBody = await json<PoolBody>(poolRes);
      expect(poolRes.status).toBe(201);

      const educator = await createTestUser({ role: 'educator' });
      await seedMember(educator.id);
      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: educator.id, poolId: poolBody.data.id }),
        },
        orgCookies(),
      );

      const response = await createAssignment(req);
      const body = await json<AssignmentBody>(response);

      expect(response.status).toBe(201);
      expect(body.data.userId).toBe(educator.id);
      const written = await supabase
        .from('org_seat_assignments')
        .select('id')
        .eq('organization_id', orgId)
        .eq('user_id', educator.id);
      expect(written.data).toHaveLength(1);
    });

    it('accepts a manager account on a personal-plan pool', async () => {
      mockUser(fixture.user);

      const poolReq = createNextRequest(
        'http://localhost/api/v1/organization/seats/pools',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey: 'ai_max', quantity: 1 }),
        },
        orgCookies(),
      );
      const poolRes = await createPool(poolReq);
      const poolBody = await json<PoolBody>(poolRes);
      expect(poolRes.status).toBe(201);
      expect(poolBody.data.planKey).toBe('ai_max');

      const manager = await createTestUser({ role: 'manager' });
      await seedMember(manager.id);
      const req = createNextRequest(
        'http://localhost/api/v1/organization/seats/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: manager.id, poolId: poolBody.data.id }),
        },
        orgCookies(),
      );

      const response = await createAssignment(req);
      const body = await json<AssignmentBody>(response);

      expect(response.status).toBe(201);
      expect(body.data.planKey).toBe('ai_max');
      expect(body.data.userId).toBe(manager.id);
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
        (
          await supabase
            .from('org_seat_assignments')
            .select('id')
            .eq('organization_id', orgId)
            .eq('pool_id', poolId)
        ).data,
      );
      const { error: fillError } = await supabase
        .from('org_seat_pools')
        .update({ total: assignedSeats.length })
        .eq('id', poolId);
      expect(fillError).toBeNull();

      const newcomer = await createTestUser({ role: 'educator' });
      await seedMember(newcomer.id);
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

  describe('org_seat_pools.assigned is service-role only (#1146)', () => {
    it('a manager can write total but not assigned; the service role writes assigned', async () => {
      // A real signed-in manager, because this is a PostgREST column
      // privilege: the RLS policy still allows the row, so the refusal must
      // name the column and not the row.
      const managerSession = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const signIn = await managerSession.auth.signInWithPassword({
        email: fixture.user.email,
        password: fixture.user.password!,
      });
      expect(signIn.error).toBeNull();

      const service = createSeedDb();
      const planKey = `test-seat-privilege-${Date.now()}`;
      const { error: planError } = await service.from('subscription_plans').insert({
        key: planKey,
        name: 'Test seat privilege',
        price_monthly: 0,
        currency: 'PLN',
        sort_order: 991,
        is_active: true,
        scope: 'personal',
        visibility: 'unlisted',
        sales_channels: ['seat_pool'],
      });
      expect(planError).toBeNull();

      const { data: pool, error: poolError } = await service
        .from('org_seat_pools')
        .insert({ organization_id: orgId, plan_key: planKey, total: 2 })
        .select('id')
        .single();
      expect(poolError).toBeNull();
      expect(pool).not.toBeNull();

      try {
        const denied = await managerSession
          .from('org_seat_pools')
          .update({ assigned: 1 })
          .eq('id', pool!.id)
          .select('id');
        expect(denied.error?.code).toBe('42501');

        const allowed = await service
          .from('org_seat_pools')
          .update({ assigned: 1 })
          .eq('id', pool!.id)
          .select('id, assigned')
          .single();
        expect(allowed.error).toBeNull();
        expect(allowed.data?.assigned).toBe(1);

        // The same manager still sets the paid count: the denial is the column,
        // not the row.
        const totalWrite = await managerSession
          .from('org_seat_pools')
          .update({ total: 3 })
          .eq('id', pool!.id)
          .select('id, total')
          .single();
        expect(totalWrite.error).toBeNull();
        expect(totalWrite.data?.total).toBe(3);
      } finally {
        await service.from('org_seat_pools').delete().eq('id', pool!.id);
        await service.from('subscription_plans').delete().eq('key', planKey);
      }
    });
  });
});
