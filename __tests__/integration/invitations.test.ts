import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { POST as bulkPost } from '@/app/(backend)/api/v1/organization/invites/bulk/route';
import {
  GET as inviteGet,
  POST as invitePost,
} from '@/app/(backend)/api/v1/organization/invites/route';
import {
  before,
  createTestUser,
  type BeforeResult,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupInvitations,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';

forEachCopy((copyId) => {
  describe(`Invitations Integration [${copyId}]`, () => {
    registerMock(copyId, null);

    let fixture!: BeforeResult;
    let student!: TestUserFixture;
    let orgId!: string;
    let adminRoleId!: string;

    beforeAll(async () => {
      // Manager creates the org via the API and becomes its admin member.
      fixture = await before({ role: 'manager', org: true });
      orgId = fixture.orgId!;
      student = await createTestUser({ role: 'student' });

      const supabase = createServiceClient();
      const { data: adminRole } = await supabase
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'admin')
        .single();
      if (!adminRole) throw new Error('Admin role not found for fixture org');
      adminRoleId = adminRole.id;
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
      await cleanupInvitations(fixture.user.id);
      await cleanupInvitations(student.id);
    });

    afterAll(async () => {
      if (orgId) {
        await cleanupOrganizationDeep(orgId);
      }
    });

    describe('POST /api/v1/organization/invites', () => {
      it('creates an invitation as manager and returns 201', async () => {
        mockUser(fixture.user);

        const req = createNextRequest('http://localhost/api/v1/organization/invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: `invite-${copyId}-${Date.now()}@example.com`,
            targetOrgRoleId: adminRoleId,
            organizationId: orgId,
          }),
        }, { active_org_id: orgId });

        const response = await invitePost(req);
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
      });

      it('returns 422 when email is invalid', async () => {
        mockUser(fixture.user);

        const req = createNextRequest('http://localhost/api/v1/organization/invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'not-an-email', targetOrgRoleId: adminRoleId }),
        }, { active_org_id: orgId });

        const response = await invitePost(req);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const req = createNextRequest('http://localhost/api/v1/organization/invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com', targetOrgRoleId: adminRoleId }),
        });

        const response = await invitePost(req);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });

      it('returns 403 when student tries to invite', async () => {
        mockUser(student);

        const req = createNextRequest('http://localhost/api/v1/organization/invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com', targetOrgRoleId: adminRoleId }),
        }, { active_org_id: orgId });

        const response = await invitePost(req);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
      });
    });

    describe('GET /api/v1/organization/invites?token=...', () => {
      it('returns invitation when token is valid', async () => {
        // Use mockUser to get a service-role client — anon role has no
        // SELECT permission on the invitations table (99_dev_grants.sql).
        mockUser(fixture.user);

        const supabase = createServiceClient();
        const { data: invitation, error } = await supabase
          .from('invitations')
          .insert({
            email: `valid-${copyId}@example.com`,
            target_org_role_id: adminRoleId,
            token: `valid-token-${copyId}-${Date.now()}`,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            inviter_id: fixture.user.id,
            organization_id: orgId,
          })
          .select()
          .single();
        if (error || !invitation) throw new Error(`Failed to insert invitation: ${error?.message}`);

        const req = createNextRequest(
          `http://localhost/api/v1/organization/invites?token=${invitation.token}`,
        );
        const response = await inviteGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.email).toBe(`valid-${copyId}@example.com`);
      });

      it('returns 404 when token does not exist', async () => {
        // Use mockUser for consistent service-role access to invitations.
        mockUser(fixture.user);

        const req = createNextRequest(
          `http://localhost/api/v1/organization/invites?token=nonexistent-token-${copyId}`,
        );
        const response = await inviteGet(req);
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.success).toBe(false);
      });

      it('returns 410 when token is expired', async () => {
        // Use mockUser to get a service-role client — anon role has no
        // SELECT permission on the invitations table (99_dev_grants.sql).
        mockUser(fixture.user);

        const supabase = createServiceClient();
        const token = `expired-token-${copyId}-${Date.now()}`;
        await supabase.from('invitations').insert({
          email: `expired-${copyId}@example.com`,
          target_org_role_id: adminRoleId,
          token,
          expires_at: new Date(Date.now() - 86400000).toISOString(),
          inviter_id: fixture.user.id,
          organization_id: orgId,
        });

        const req = createNextRequest(
          `http://localhost/api/v1/organization/invites?token=${token}`,
        );
        const response = await inviteGet(req);
        const body = await response.json();

        expect(response.status).toBe(410);
        expect(body.success).toBe(false);
      });

      it('returns 401 when token is empty (treated as no token, requires auth)', async () => {
        mockUser(null);
        const req = createNextRequest('http://localhost/api/v1/organization/invites?token=');
        const response = await inviteGet(req);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });
    });

    describe('POST /api/v1/organization/invites/bulk', () => {
      it('bulk creates invitations and returns 200', async () => {
        mockUser(fixture.user);

        const req = createNextRequest('http://localhost/api/v1/organization/invites/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invitations: [
              { email: `bulk1-${copyId}-${Date.now()}@example.com`, targetOrgRoleId: adminRoleId },
              { email: `bulk2-${copyId}-${Date.now()}@example.com`, targetOrgRoleId: adminRoleId },
            ],
          }),
        }, { active_org_id: orgId });

        const response = await bulkPost(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data.results)).toBe(true);
      });

      it('returns 422 when invitations array is empty', async () => {
        mockUser(fixture.user);

        const req = createNextRequest('http://localhost/api/v1/organization/invites/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invitations: [] }),
        }, { active_org_id: orgId });

        const response = await bulkPost(req);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
      });
    });
  });
});
