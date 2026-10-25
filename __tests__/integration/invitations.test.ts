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
    let teacher!: TestUserFixture;
    let orgId!: string;
    let adminRoleId!: string;
    let memberRoleId!: string;
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

      const { data: memberRole } = await supabase
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'member')
        .single();
      if (!memberRole) throw new Error('Member role not found for fixture org');
      memberRoleId = memberRole.id;

      // #189: an org teacher is an edu-classroom inviter — may grant the system
      // member role only, never admin.
      const { data: teacherRole } = await supabase
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'teacher')
        .single();
      if (!teacherRole) throw new Error('Teacher role not found for fixture org');
      teacher = await createTestUser({ role: 'educator' });
      await seedOrgMembership({
        organizationId: orgId,
        userId: teacher.id,
        orgRoleId: teacherRole.id,
      });

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
      await cleanupInvitations(teacher.id);
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
        const email = `invite-${copyId}-${Date.now()}@example.com`;

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
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
        expect(body.data.success).toBe(true);

        // #313: the manager must receive the copyable link in every environment
        // (this suite does not run under NODE_ENV=development), and it must carry
        // the token that was actually persisted for this address.
        const { data: row, error } = await createServiceClient()
          .from('invitations')
          .select('token')
          .eq('email', email)
          .single();
        if (error) throw new Error(`Failed to read invitation token: ${error.message}`);

        expect(typeof body.data.inviteLink).toBe('string');
        const link = new URL(body.data.inviteLink);
        expect(link.pathname).toBe('/join');
        expect(link.searchParams.get('token')).toBe(row.token);
        // #317: the creator gets the bare code too, so „Kopiuj kod” works.
        expect(body.data.inviteCode).toBe(row.token);
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

      // #189: grant authority is evaluated by the endpoint, not just by the
      // INSERT policy — a teacher may only grant the system `member` role.
      it('returns 403 when an org teacher invites the admin role (#189)', async () => {
        mockUser(teacher);
        const email = `qa-teacher-admin-${copyId}-${Date.now()}@example.com`;

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, targetOrgRoleId: adminRoleId }),
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
          .select('id')
          .eq('email', email);
        expect(data).toEqual([]);
      });

      // #189 control: teachers must keep inviting students, so the new gate
      // must not over-restrict the classroom flow.
      it('allows an org teacher to invite the member role (#189 control)', async () => {
        mockUser(teacher);
        const email = `qa-teacher-member-${copyId}-${Date.now()}@example.com`;

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, targetOrgRoleId: memberRoleId }),
          },
          { active_org_id: orgId },
        );

        const response = await invitePost(req);
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
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

      // #317: the preview field accepts the „Kopiuj link” URL too.
      it('returns the invitation when the pasted value is the full invite link (#317)', async () => {
        mockUser(fixture.user);

        const supabase = createServiceClient();
        const token = Array.from({ length: 32 }, () =>
          Math.floor(Math.random() * 16).toString(16),
        ).join('');
        const email = `link-${copyId}-${Date.now()}@example.com`;
        const { error } = await supabase.from('invitations').insert({
          email,
          target_org_role_id: adminRoleId,
          token,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          inviter_id: fixture.user.id,
          organization_id: orgId,
        });
        if (error) throw new Error(`Failed to insert invitation: ${error.message}`);

        const link = `http://localhost:3012/join?token=${token.toUpperCase()}`;
        const response = await inviteGet(
          createNextRequest(
            `http://localhost/api/v1/organization/invites?token=${encodeURIComponent(link)}`,
          ),
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.email).toBe(email);
      });

      it('returns 404 for a link that carries no token (#317)', async () => {
        mockUser(fixture.user);

        const response = await inviteGet(
          createNextRequest(
            `http://localhost/api/v1/organization/invites?token=${encodeURIComponent(
              'http://localhost:3012/join',
            )}`,
          ),
        );

        expect(response.status).toBe(404);
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

        const stamp = Date.now();
        const emails = [
          `bulk1-${copyId}-${stamp}@example.com`,
          `bulk2-${copyId}-${stamp}@example.com`,
        ];

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              invitations: [
                { email: emails[0], targetOrgRoleId: adminRoleId },
                { email: emails[1], targetOrgRoleId: adminRoleId },
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
        // MGR-INV-02: „Wyniki” needs one attributed status per entered address.
        expect(body.data.results.map((r: { email: string }) => r.email)).toEqual(emails);

        // #313: every manager-visible row is individually deliverable — each
        // result carries the link for the token persisted against that address.
        const { data: rows, error } = await createServiceClient()
          .from('invitations')
          .select('email, token')
          .in('email', emails);
        if (error) throw new Error(`Failed to read invitation tokens: ${error.message}`);
        const tokenByEmail = new Map(
          (rows ?? []).map((row) => [row.email as string, row.token as string]),
        );

        for (const result of body.data.results as Array<{
          email: string;
          data: { inviteLink?: string; inviteCode?: string };
        }>) {
          expect(typeof result.data.inviteLink).toBe('string');
          const link = new URL(result.data.inviteLink as string);
          expect(link.pathname).toBe('/join');
          expect(link.searchParams.get('token')).toBe(tokenByEmail.get(result.email));
          // #317: the bare code is returned per row alongside the link.
          expect(result.data.inviteCode).toBe(tokenByEmail.get(result.email));
        }
      });

      // #189: the endpoint itself rejects a role the caller may not grant,
      // before any write — a teacher may only grant the system member role.
      it('returns 403 when an org teacher bulk-invites the admin role (#189)', async () => {
        mockUser(teacher);
        const email = `qa-bulk-teacher-admin-${copyId}-${Date.now()}@example.com`;

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              invitations: [{ email, targetOrgRoleId: adminRoleId }],
            }),
          },
          { active_org_id: orgId },
        );

        const response = await bulkPost(req);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.error).toBe('FORBIDDEN');

        const { data } = await createServiceClient()
          .from('invitations')
          .select('id')
          .eq('email', email);
        expect(data).toEqual([]);
      });

      it('returns 403 when a student bulk-invites (#189)', async () => {
        mockUser(student);

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              invitations: [
                {
                  email: `qa-bulk-student-${copyId}-${Date.now()}@example.com`,
                  targetOrgRoleId: memberRoleId,
                },
              ],
            }),
          },
          { active_org_id: orgId },
        );

        const response = await bulkPost(req);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
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

      // MGR-INV-02: a batch is all-or-nothing. One bad entry must reject the
      // whole request and leave no invitation behind.
      it('rejects the whole batch when one role belongs to another organization', async () => {
        mockUser(fixture.user);

        const stamp = Date.now();
        const emails = [
          `bulk-ok-${copyId}-${stamp}@example.com`,
          `bulk-foreign-${copyId}-${stamp}@example.com`,
        ];

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              invitations: [
                { email: emails[0], targetOrgRoleId: adminRoleId },
                { email: emails[1], targetOrgRoleId: foreignAdminRoleId },
              ],
            }),
          },
          { active_org_id: orgId },
        );

        const response = await bulkPost(req);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
        expect(body.error).toBe('UNPROCESSABLE_ENTITY');

        const supabase = createServiceClient();
        const { data: leftover } = await supabase
          .from('invitations')
          .select('id, email')
          .in('email', emails);
        // Not even the valid first entry was written.
        expect(leftover ?? []).toEqual([]);
      });

      it('rejects the whole batch when one entry has no role and writes no rows', async () => {
        mockUser(fixture.user);

        const stamp = Date.now();
        const emails = [
          `bulk-missing-ok-${copyId}-${stamp}@example.com`,
          `bulk-missing-role-${copyId}-${stamp}@example.com`,
        ];

        const req = createNextRequest(
          'http://localhost/api/v1/organization/invites/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              invitations: [
                { email: emails[0], targetOrgRoleId: adminRoleId },
                { email: emails[1] },
              ],
            }),
          },
          { active_org_id: orgId },
        );

        const response = await bulkPost(req);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
        expect(body.issues).toBeDefined();

        const supabase = createServiceClient();
        const { data: leftover } = await supabase
          .from('invitations')
          .select('id, email')
          .in('email', emails);
        expect(leftover ?? []).toEqual([]);
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
