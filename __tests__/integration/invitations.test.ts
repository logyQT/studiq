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
  cleanupInvitations,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
  seedOrganization,
  seedOrgMembership,
  useRealSupabase,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import {
  DELETE as inviteDelete,
  PUT as invitePut,
} from '@/app/(backend)/api/v1/organization/invites/[id]/route';
import { POST as bulkPost } from '@/app/(backend)/api/v1/organization/invites/bulk/route';
import {
  GET as inviteGet,
  POST as invitePost,
} from '@/app/(backend)/api/v1/organization/invites/route';

forEachCopy((copyId) => {
  describe(`Invitations Integration [${copyId}]`, () => {
    registerMock(copyId, null);

    let fixture!: BeforeResult;
    let student!: TestUserFixture;
    let orgId!: string;
    let adminRoleId!: string;
    /** Second manager — under no circumstances may they touch org A's invites. */
    let foreignFixture!: BeforeResult;
    let foreignOrgId!: string;
    let foreignAdminRoleId!: string;
    /** #242: a foreign org's member role — M1 may not invite into that org. */
    let foreignMemberRoleId!: string;
    /**
     * #242 control: the fixture manager IS a member here, but it is not the
     * active org. `organizationId` may select it.
     */
    let controlOrg!: Awaited<ReturnType<typeof seedOrganization>>;

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

      // MGR-INV-03: a manager of a different organization.
      foreignFixture = await before({ role: 'manager', org: true });
      foreignOrgId = foreignFixture.orgId!;
      const { data: foreignAdminRole } = await supabase
        .from('org_roles')
        .select('id')
        .eq('organization_id', foreignOrgId)
        .eq('name', 'admin')
        .single();
      if (!foreignAdminRole) throw new Error('Admin role not found for foreign org');
      foreignAdminRoleId = foreignAdminRole.id;

      const { data: foreignMemberRole } = await supabase
        .from('org_roles')
        .select('id')
        .eq('organization_id', foreignOrgId)
        .eq('name', 'member')
        .single();
      if (!foreignMemberRole) throw new Error('Member role not found for foreign org');
      foreignMemberRoleId = foreignMemberRole.id;

      // #242 control: a second membership for the fixture manager. It is not the
      // active org, but `organizationId` may still select it.
      controlOrg = await seedOrganization(`QA #242 control ${copyId} ${Date.now()}`);
      await seedOrgMembership({
        organizationId: controlOrg.org.id,
        userId: fixture.user.id,
        orgRoleId: controlOrg.adminRoleId,
      });
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
      await cleanupInvitations(fixture.user.id);
      await cleanupInvitations(student.id);
      await cleanupInvitations(foreignFixture.user.id);
    });

    afterAll(async () => {
      if (orgId) {
        await cleanupOrganizationDeep(orgId);
      }
      if (foreignOrgId) {
        await cleanupOrganizationDeep(foreignOrgId);
      }
      if (controlOrg?.org.id) {
        await cleanupOrganizationDeep(controlOrg.org.id);
      }
    });

    describe('POST /api/v1/organization/invites', () => {
      it('creates an invitation as manager and returns 201', async () => {
        mockUser(fixture.user);

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: `invite-${copyId}-${Date.now()}@example.com`,
              targetOrgRoleId: adminRoleId,
              organizationId: orgId,
            }),
          },
          { active_org_id: orgId },
        );

        const response = await invitePost(req);
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
      });

      // #242: the body-supplied organizationId must not extend the caller's
      // tenant. manager@fixture is not a member of the foreign org.
      it('returns 403 and writes no row for a foreign organizationId (#242)', async () => {
        mockUser(fixture.user);
        const email = `qa-cross-org-ag-${copyId}-${Date.now()}@example.com`;

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              targetOrgRoleId: foreignMemberRoleId,
              organizationId: foreignOrgId,
            }),
          },
          { active_org_id: orgId },
        );

        const response = await invitePost(req);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.error).toBe('FORBIDDEN');

        const { data } = await createServiceClient()
          .from('invitations')
          .select('id, organization_id')
          .eq('email', email);
        expect(data).toEqual([]);
      });

      // #242: active_org_id is a client-controlled cookie, so pointing it at a
      // foreign org must not become a write target either.
      it('returns 403 and writes no row for a forged active_org_id cookie (#242)', async () => {
        mockUser(fixture.user);
        const email = `qa-cookie-spoof-${copyId}-${Date.now()}@example.com`;

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, targetOrgRoleId: foreignMemberRoleId }),
          },
          { active_org_id: foreignOrgId },
        );

        const response = await invitePost(req);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);

        const { data } = await createServiceClient()
          .from('invitations')
          .select('id')
          .eq('email', email);
        expect(data).toEqual([]);
      });

      // #242: a role from another org would leak that tenant's permission
      // scopes into the target org when the invitation is accepted.
      it('returns 403 and writes no row for a role from another org (#242)', async () => {
        mockUser(fixture.user);
        const email = `qa-cross-org-role-${copyId}-${Date.now()}@example.com`;

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, targetOrgRoleId: foreignMemberRoleId }),
          },
          { active_org_id: orgId },
        );

        const response = await invitePost(req);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);

        const { data } = await createServiceClient()
          .from('invitations')
          .select('id')
          .eq('email', email);
        expect(data).toEqual([]);
      });

      // #242 control (the issue's UE Wrocław case): a membership that is not the
      // active org is a valid target, so the field is scoped, not ignored.
      it('creates the invitation in a member org that is not active (#242 control)', async () => {
        mockUser(fixture.user);
        const email = `qa-control-${copyId}-${Date.now()}@example.com`;

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              targetOrgRoleId: controlOrg.memberRoleId,
              organizationId: controlOrg.org.id,
            }),
          },
          { active_org_id: orgId },
        );

        const response = await invitePost(req);
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);

        const { data } = await createServiceClient()
          .from('invitations')
          .select('organization_id')
          .eq('email', email)
          .single();
        expect(data?.organization_id).toBe(controlOrg.org.id);
      });

      it('returns 422 when email is invalid', async () => {
        mockUser(fixture.user);

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'not-an-email', targetOrgRoleId: adminRoleId }),
          },
          { active_org_id: orgId },
        );

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

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test@example.com', targetOrgRoleId: adminRoleId }),
          },
          { active_org_id: orgId },
        );

        const response = await invitePost(req);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
      });
    });

    describe('GET /api/v1/organization/invites?token=...', () => {
      it('returns invitation when token is valid', async () => {
        // Seed via the service-role client; the preview route itself is public and
        // is covered by the anonymous test below.
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
        // Service-role client for consistent read access; the route is public.
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
        // Service-role client for consistent read access; the route is public.
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

      // #236: a logged-out visitor loads /join?token=… before they have an
      // account. The preview must work with a real anon session — i.e. without
      // the request-scoped client, which `anon` cannot use to read invitations.
      it('returns a valid invitation to an anonymous caller (#236)', async () => {
        const supabase = createServiceClient();
        const token = `anon-valid-${copyId}-${Date.now()}`;
        const { error } = await supabase.from('invitations').insert({
          email: `anon-${copyId}@example.com`,
          target_org_role_id: adminRoleId,
          token,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          inviter_id: fixture.user.id,
          organization_id: orgId,
        });
        if (error) throw new Error(`Failed to insert invitation: ${error.message}`);

        // Real anon client: no session, no service-role key. Do NOT use
        // mockUser(null) here — that helper still returns a service-role client
        // and would mask a regression back to the request-scoped client.
        useRealSupabase();

        const req = createNextRequest(
          `http://localhost/api/v1/organization/invites?token=${token}`,
        );
        const response = await inviteGet(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.email).toBe(`anon-${copyId}@example.com`);
        expect(body.data.organizationName).toBeTruthy();
        expect(body.data.orgRoleName).toBeTruthy();
      });

      it('returns 410 for an expired token to an anonymous caller (#236)', async () => {
        const supabase = createServiceClient();
        const token = `anon-expired-${copyId}-${Date.now()}`;
        const { error } = await supabase.from('invitations').insert({
          email: `anon-expired-${copyId}@example.com`,
          target_org_role_id: adminRoleId,
          token,
          expires_at: new Date(Date.now() - 86400000).toISOString(),
          inviter_id: fixture.user.id,
          organization_id: orgId,
        });
        if (error) throw new Error(`Failed to insert invitation: ${error.message}`);

        useRealSupabase();

        const response = await inviteGet(
          createNextRequest(`http://localhost/api/v1/organization/invites?token=${token}`),
        );

        expect(response.status).toBe(410);
      });

      it('returns 410 when the token was already accepted', async () => {
        mockUser(fixture.user);

        const supabase = createServiceClient();
        const token = `used-token-${copyId}-${Date.now()}`;
        await supabase.from('invitations').insert({
          email: `used-${copyId}@example.com`,
          target_org_role_id: adminRoleId,
          token,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          inviter_id: fixture.user.id,
          organization_id: orgId,
          is_accepted: true,
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

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              invitations: [
                {
                  email: `bulk1-${copyId}-${Date.now()}@example.com`,
                  targetOrgRoleId: adminRoleId,
                },
                {
                  email: `bulk2-${copyId}-${Date.now()}@example.com`,
                  targetOrgRoleId: adminRoleId,
                },
              ],
            }),
          },
          { active_org_id: orgId },
        );

        const response = await bulkPost(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data.results)).toBe(true);
      });

      it('returns 422 when invitations array is empty', async () => {
        mockUser(fixture.user);

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invitations: [] }),
          },
          { active_org_id: orgId },
        );

        const response = await bulkPost(req);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
      });
    });

    // MGR-INV-03: an invitation id must never be enough — the row has to belong
    // to the caller's verified active organization.
    describe('DELETE/PUT /api/v1/organization/invites/{id} cross-org scoping', () => {
      async function seedInvite(): Promise<string> {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from('invitations')
          .insert({
            email: `cross-org-${copyId}-${Date.now()}@example.com`,
            target_org_role_id: adminRoleId,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            inviter_id: fixture.user.id,
            organization_id: orgId,
          })
          .select('id')
          .single();
        if (error || !data) throw new Error(`Failed to insert invitation: ${error?.message}`);
        return data.id;
      }

      async function inviteExists(id: string): Promise<boolean> {
        const { data } = await createServiceClient()
          .from('invitations')
          .select('id')
          .eq('id', id)
          .maybeSingle();
        return data !== null;
      }

      async function inviteRole(id: string): Promise<string | null> {
        const { data } = await createServiceClient()
          .from('invitations')
          .select('target_org_role_id')
          .eq('id', id)
          .maybeSingle();
        return data?.target_org_role_id ?? null;
      }

      it("returns 404 and keeps the row when manager B deletes org A's invitation", async () => {
        const inviteId = await seedInvite();
        mockUser(foreignFixture.user);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/organization/invites/${inviteId}`,
          { id: inviteId },
          { method: 'DELETE' },
          { active_org_id: foreignOrgId },
        );
        const response = await inviteDelete(request, { params });

        expect(response.status).toBe(404);
        expect(await inviteExists(inviteId)).toBe(true);
      });

      it('returns 403 for a forged active_org_id cookie without a membership row', async () => {
        const inviteId = await seedInvite();
        // manager B claims org A as active: withAuth finds no org_members row,
        // so orgRoleId stays null and the service must refuse outright.
        mockUser(foreignFixture.user);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/organization/invites/${inviteId}`,
          { id: inviteId },
          { method: 'DELETE' },
          { active_org_id: orgId },
        );
        const response = await inviteDelete(request, { params });

        expect(response.status).toBe(403);
        expect(await inviteExists(inviteId)).toBe(true);
      });

      it('deletes the invitation for a manager of the owning organization', async () => {
        const inviteId = await seedInvite();
        mockUser(fixture.user);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/organization/invites/${inviteId}`,
          { id: inviteId },
          { method: 'DELETE' },
          { active_org_id: orgId },
        );
        const response = await inviteDelete(request, { params });

        expect(response.status).toBe(200);
        expect(await inviteExists(inviteId)).toBe(false);
      });

      it("returns 404 and keeps the role when manager B updates org A's invitation", async () => {
        const inviteId = await seedInvite();
        mockUser(foreignFixture.user);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/organization/invites/${inviteId}`,
          { id: inviteId },
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetOrgRoleId: foreignAdminRoleId }),
          },
          { active_org_id: foreignOrgId },
        );
        const response = await invitePut(request, { params });

        expect(response.status).toBe(404);
        expect(await inviteRole(inviteId)).toBe(adminRoleId);
      });

      it('returns 422 and keeps the role when the target role belongs to another org', async () => {
        const inviteId = await seedInvite();
        mockUser(fixture.user);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/organization/invites/${inviteId}`,
          { id: inviteId },
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetOrgRoleId: foreignAdminRoleId }),
          },
          { active_org_id: orgId },
        );
        const response = await invitePut(request, { params });

        expect(response.status).toBe(422);
        expect(await inviteRole(inviteId)).toBe(adminRoleId);
      });
    });
  });
});
