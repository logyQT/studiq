import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { GET as getPools } from '@/app/(backend)/api/v1/organization/seats/pools/route';
import { PUT as updatePool } from '@/app/(backend)/api/v1/organization/seats/pools/[id]/route';
import {
  GET as getAssignments,
  POST as createAssignment,
} from '@/app/(backend)/api/v1/organization/seats/assignments/route';
import { DELETE as deleteAssignment } from '@/app/(backend)/api/v1/organization/seats/assignments/[id]/route';
import {
  before,
  createTestUser,
  type BeforeResult,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';

/**
 * Fetches the launch seat pool ID for the current test org.
 */
async function getLaunchPoolId(orgId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data: pool } = await supabase
    .from('org_seat_pools')
    .select('id')
    .eq('organization_id', orgId)
    .eq('plan_key', 'launch')
    .single();
  if (!pool) throw new Error('Launch pool not found — trigger may not have run');
  return pool.id;
}

forEachCopy((copyId) => {
  describe(`Seats Integration [${copyId}]`, () => {
    registerMock(copyId, null);

    let fixture!: BeforeResult;
    let orgId!: string;
    let poolId!: string;
    let assigneeA!: TestUserFixture;
    let assigneeB!: TestUserFixture;
    let assigneeC!: TestUserFixture;
    let student!: TestUserFixture;

    const orgCookies = () => ({ active_org_id: orgId });

    beforeAll(async () => {
      // Manager creates the org via the API (launch plan by default) →
      // the handle_new_organization trigger seeds the launch seat pool.
      fixture = await before({ role: 'manager', org: true });
      orgId = fixture.orgId!;
      poolId = await getLaunchPoolId(orgId);

      // Unique assignee users per copy (org_seat_assignments
      // has a UNIQUE(organization_id, user_id) constraint).
      assigneeA = await createTestUser({ role: 'educator' });
      assigneeB = await createTestUser({ role: 'educator' });
      assigneeC = await createTestUser({ role: 'educator' });
      student = await createTestUser({ role: 'student' });
    });

    beforeEach(() => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
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
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data).toBeInstanceOf(Array);
        expect(body.data.length).toBeGreaterThanOrEqual(1);

        const pool = body.data.find((p: any) => p.planKey === 'launch');
        expect(pool).toBeDefined();
        expect(pool.total).toBe(1);
        expect(pool.assigned).toBe(0);
      });

      it('returns 403 for non-manager users', async () => {
        mockUser(student);

        const req = createNextRequest(
          'http://localhost/api/v1/organization/seats/pools',
          undefined,
          orgCookies(),
        );

        const response = await getPools(req);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.error).toBe('FORBIDDEN');
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
        const body = await response.json();

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
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
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
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data).toBeInstanceOf(Array);
        expect(body.data).toHaveLength(0);
      });
    });

    describe('POST /assignments', () => {
      it('creates an assignment', async () => {
        mockUser(fixture.user);

        const { request, params } = createNextRequestWithParams(
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
        const body = await response.json();

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
        const listBody = await listRes.json();

        expect(listBody.data.length).toBeGreaterThanOrEqual(1);
        const match = listBody.data.find((a: any) => a.userId === assigneeB.id);
        expect(match).toBeDefined();
        expect(match.poolId).toBe(poolId);
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
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
      });
    });

    describe('DELETE /assignments/[id]', () => {
      let assignmentId: string;

      beforeEach(async () => {
        // Seed an assignment to delete (use service role to bypass trigger)
        const supabase = createServiceClient();
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
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);

        // Verify deleted
        const listReq = createNextRequest(
          'http://localhost/api/v1/organization/seats/assignments',
          undefined,
          orgCookies(),
        );
        const listRes = await getAssignments(listReq);
        const listBody = await listRes.json();

        const match = listBody.data.find((a: any) => a.id === assignmentId);
        expect(match).toBeUndefined();
      });
    });

    describe('Hard block: pool capacity', () => {
      beforeEach(async () => {
        const supabase = createServiceClient();
        await supabase
          .from('org_seat_pools')
          .update({ total: 0 })
          .eq('id', poolId);
      });

      it('returns USAGE_LIMIT_EXCEEDED when pool is full', async () => {
        mockUser(fixture.user);

        const req = createNextRequest(
          'http://localhost/api/v1/organization/seats/assignments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: assigneeC.id,
              poolId,
            }),
          },
          orgCookies(),
        );

        const response = await createAssignment(req);
        const body = await response.json();

        expect(response.status).toBe(429);
        expect(body.success).toBe(false);
        expect(body.error).toBe('USAGE_LIMIT_EXCEEDED');
      });
    });
  });
});
