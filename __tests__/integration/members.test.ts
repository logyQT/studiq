import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { DELETE, GET, PUT } from '@/app/(backend)/api/v1/organization/members/route';

forEachCopy((copyId) => {
  describe(`Members Integration [${copyId}]`, () => {
    registerMock(copyId, null);

    let fixture!: BeforeResult;
    let orgId!: string;
    let adminRoleId!: string;
    let memberRoleId!: string;
    let member!: TestUserFixture;
    let foreignFixture!: BeforeResult;
    let foreignOrgId!: string;
    let foreignAdminRoleId!: string;

    beforeAll(async () => {
      fixture = await before({
        role: 'manager',
        org: true,
        members: { count: 1 },
      });
      orgId = fixture.orgId!;
      member = fixture.memberUsers[0];

      const supabase = createServiceClient();
      const { data: adminRole } = await supabase
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'admin')
        .single();
      adminRoleId = adminRole!.id;

      const { data: memberRole } = await supabase
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'member')
        .single();
      memberRoleId = memberRole!.id;

      // #189: a manager of a different org, used to prove a no-op delete/update
      // is NOT_FOUND instead of a misleading 200.
      foreignFixture = await before({ role: 'manager', org: true });
      foreignOrgId = foreignFixture.orgId!;
      const { data: foreignAdminRole } = await supabase
        .from('org_roles')
        .select('id')
        .eq('organization_id', foreignOrgId)
        .eq('name', 'admin')
        .single();
      foreignAdminRoleId = foreignAdminRole!.id;
    });

    beforeEach(() => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
    });

    afterAll(async () => {
      if (orgId) {
        await cleanupOrganizationDeep(orgId);
      }
      if (foreignOrgId) {
        await cleanupOrganizationDeep(foreignOrgId);
      }
    });

    describe('GET /api/v1/organization/members', () => {
      it('lists members for the org admin', async () => {
        mockUser(fixture.user);

        const req = createNextRequest('http://localhost/api/v1/organization/members', undefined, {
          active_org_id: orgId,
        });
        const response = await GET(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data.length).toBeGreaterThanOrEqual(2);
      });

      it('filters members by role', async () => {
        mockUser(fixture.user);

        const req = createNextRequest(
          'http://localhost/api/v1/organization/members?role=member',
          undefined,
          {
            active_org_id: orgId,
          },
        );
        const response = await GET(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(Array.isArray(body.data)).toBe(true);
      });

      it('returns 403 when user has no organization', async () => {
        const noOrg = await createTestUser({ role: 'student' });
        mockUser(noOrg);

        const req = createNextRequest('http://localhost/api/v1/organization/members');
        const response = await GET(req);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const req = createNextRequest('http://localhost/api/v1/organization/members');
        const response = await GET(req);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });
    });

    describe('PUT /api/v1/organization/members', () => {
      it('changes role successfully', async () => {
        mockUser(fixture.user);

        const req = createNextRequest(
          'http://localhost/api/v1/organization/members',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetUserId: member.id,
              newOrgRoleId: adminRoleId,
            }),
          },
          { active_org_id: orgId },
        );

        const response = await PUT(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
      });

      it('returns 422 when input is invalid', async () => {
        mockUser(fixture.user);

        const req = createNextRequest(
          'http://localhost/api/v1/organization/members',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetUserId: '',
              newOrgRoleId: 'invalid-uuid',
            }),
          },
          { active_org_id: orgId },
        );

        const response = await PUT(req);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
      });

      // #189: changeRole already returns NOT_FOUND for a 0-row update — this
      // locks the cross-org case so a management endpoint never fakes success.
      it('returns 404 for a manager of another org (#189)', async () => {
        const target = await createTestUser({ role: 'student' });
        await seedOrgMembership({
          organizationId: orgId,
          userId: target.id,
          orgRoleId: memberRoleId,
        });
        mockUser(foreignFixture.user);

        const req = createNextRequest(
          'http://localhost/api/v1/organization/members',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetUserId: target.id,
              newOrgRoleId: foreignAdminRoleId,
            }),
          },
          { active_org_id: foreignOrgId },
        );

        const response = await PUT(req);
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.success).toBe(false);

        const { data } = await createServiceClient()
          .from('org_members')
          .select('org_role_id')
          .eq('organization_id', orgId)
          .eq('user_id', target.id)
          .single();
        expect(data?.org_role_id).toBe(memberRoleId);
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const req = createNextRequest('http://localhost/api/v1/organization/members', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUserId: member.id,
            newOrgRoleId: adminRoleId,
          }),
        });

        const response = await PUT(req);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });
    });

    describe('DELETE /api/v1/organization/members', () => {
      it('removes member successfully', async () => {
        mockUser(fixture.user);

        const req = createNextRequest(
          `http://localhost/api/v1/organization/members?userId=${member.id}`,
          { method: 'DELETE' },
          { active_org_id: orgId },
        );

        const response = await DELETE(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
      });

      it("releases the removed member's seat assignment (review-2-r3 B2)", async () => {
        // A removed member keeps no license: the org_members delete must also
        // drop the org_seat_assignments row (there is no FK cascade) so the
        // pool's `assigned` counter is returned and no orphan is left behind.
        const supabase = createServiceClient();
        const seatUser = await createTestUser({ role: 'student' });
        await seedOrgMembership({
          organizationId: orgId,
          userId: seatUser.id,
          orgRoleId: memberRoleId,
        });

        const { data: pool, error: poolError } = await supabase
          .from('org_seat_pools')
          .insert({ organization_id: orgId, plan_key: 'pro', total: 1, assigned: 0 })
          .select('id')
          .single();
        expect(poolError).toBeNull();

        const { error: assignmentError } = await supabase.from('org_seat_assignments').insert({
          organization_id: orgId,
          pool_id: pool?.id as string,
          user_id: seatUser.id,
        });
        expect(assignmentError).toBeNull();

        mockUser(fixture.user);
        const req = createNextRequest(
          `http://localhost/api/v1/organization/members?userId=${seatUser.id}`,
          { method: 'DELETE' },
          { active_org_id: orgId },
        );

        const response = await DELETE(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);

        const { count: seatCount } = await supabase
          .from('org_seat_assignments')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('user_id', seatUser.id);
        expect(seatCount).toBe(0);

        const { data: poolAfter } = await supabase
          .from('org_seat_pools')
          .select('assigned')
          .eq('id', pool?.id as string)
          .single();
        expect(poolAfter?.assigned).toBe(0);
      });

      // #189: a 0-row delete used to answer {"success":true}. A foreign org's
      // manager must get 404 and the target membership must be untouched.
      it('returns 404 for a manager of another org and keeps the membership (#189)', async () => {
        const supabase = createServiceClient();
        const target = await createTestUser({ role: 'student' });
        await seedOrgMembership({
          organizationId: orgId,
          userId: target.id,
          orgRoleId: memberRoleId,
        });

        mockUser(foreignFixture.user);
        const req = createNextRequest(
          `http://localhost/api/v1/organization/members?userId=${target.id}`,
          { method: 'DELETE' },
          { active_org_id: foreignOrgId },
        );

        const response = await DELETE(req);
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.success).toBe(false);

        const { data } = await supabase
          .from('org_members')
          .select('user_id')
          .eq('organization_id', orgId)
          .eq('user_id', target.id);
        expect(data).toEqual([{ user_id: target.id }]);
      });

      it('returns 404 when the target is not a member of the active org (#189)', async () => {
        const stranger = await createTestUser({ role: 'student' });
        mockUser(fixture.user);

        const req = createNextRequest(
          `http://localhost/api/v1/organization/members?userId=${stranger.id}`,
          { method: 'DELETE' },
          { active_org_id: orgId },
        );

        const response = await DELETE(req);
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.success).toBe(false);
        expect(body.error).toBe('NOT_FOUND');
      });

      it('returns 400 when userId is empty', async () => {
        mockUser(fixture.user);

        const req = createNextRequest(
          'http://localhost/api/v1/organization/members?userId=',
          {
            method: 'DELETE',
          },
          { active_org_id: orgId },
        );

        const response = await DELETE(req);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.success).toBe(false);
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const req = createNextRequest(
          `http://localhost/api/v1/organization/members?userId=${member.id}`,
          { method: 'DELETE' },
        );

        const response = await DELETE(req);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });
    });
  });
});
