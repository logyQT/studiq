import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { before, createTestUser } from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { POST as acceptPost } from '@/app/(backend)/api/v1/organization/invites/accept/route';
import { POST as bulkPost } from '@/app/(backend)/api/v1/organization/invites/bulk/route';
import { POST as invitePost } from '@/app/(backend)/api/v1/organization/invites/route';

// Regression suite for the two onboarding blockers fixed in the seed flow:
// - 422 on bulk invite (targetOrgRoleId was sent as the role NAME 'member',
//   backend requires the org_role UUID)
// - 429 on invite accept for freshly registered 'base'-plan students
//   (getEffectiveLimit('max_students') returned 0 because the student has no
//   active org — now resolved against the invitation's organization plan)
forEachCopy((copyId) => {
  describe(`Invite + accept regression (API-first) [${copyId}]`, () => {
    registerMock(copyId, null);

    const createdOrgIds: string[] = [];

    beforeEach(() => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
    });

    afterAll(async () => {
      for (const orgId of createdOrgIds) {
        await cleanupOrganizationDeep(orgId);
      }
    });

    async function roleIds(orgId: string) {
      const supabase = createServiceClient();
      const { data: roles } = await supabase
        .from('org_roles')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('is_system', true);
      const byName = Object.fromEntries((roles ?? []).map((r) => [r.name, r.id]));
      return {
        adminRoleId: byName.admin as string,
        teacherRoleId: byName.teacher as string,
        memberRoleId: byName.member as string,
      };
    }

    it('bulk invite accepts the member role uuid returned by org creation', async () => {
      const fixture = await before({ role: 'manager', org: true });
      createdOrgIds.push(fixture.orgId!);
      const { memberRoleId } = await roleIds(fixture.orgId!);

      mockUser(fixture.user);
      const req = createNextRequest(
        'http://localhost/api/v1/organization/invites/bulk',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invitations: [
              { email: `bulk-${copyId}-${Date.now()}@example.com`, targetOrgRoleId: memberRoleId },
              {
                email: `bulk-${copyId}-${Date.now()}-2@example.com`,
                targetOrgRoleId: memberRoleId,
              },
            ],
          }),
        },
        { active_org_id: fixture.orgId! },
      );

      const response = await bulkPost(req);
      const body = await response.json();

      expect(response.ok).toBe(true);
      expect(body.success).toBe(true);
      expect(body.data.results).toHaveLength(2);
      expect(body.data.results.every((r: { success: boolean }) => r.success)).toBe(true);
    });

    it('fresh base-plan student can accept an invite and joins org + default group', async () => {
      const fixture = await before({ role: 'manager', org: true });
      createdOrgIds.push(fixture.orgId!);
      const student = await createTestUser({ role: 'student' });
      const { memberRoleId } = await roleIds(fixture.orgId!);

      mockUser(fixture.user);
      const inviteReq = createNextRequest(
        'http://localhost/api/v1/organization/invites',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: student.email,
            targetOrgRoleId: memberRoleId,
          }),
        },
        { active_org_id: fixture.orgId! },
      );
      const inviteRes = await invitePost(inviteReq);
      expect(inviteRes.status).toBe(201);

      const supabase = createServiceClient();
      const { data: invite } = await supabase
        .from('invitations')
        .select('token')
        .eq('email', student.email)
        .eq('organization_id', fixture.orgId!)
        .single();
      expect(invite).toBeTruthy();

      mockUser(student);
      const acceptReq = createNextRequest('http://localhost/api/v1/organization/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: invite!.token }),
      });
      const acceptRes = await acceptPost(acceptReq);
      const acceptBody = await acceptRes.json();

      expect(acceptRes.status).toBe(200);
      expect(acceptBody.success).toBe(true);

      const { data: membership } = await supabase
        .from('org_members')
        .select('*')
        .eq('organization_id', fixture.orgId!)
        .eq('user_id', student.id)
        .maybeSingle();
      expect(membership).toBeTruthy();

      const { data: groupMember } = await supabase
        .from('group_members')
        .select('*')
        .eq('group_id', fixture.defaultGroupId!)
        .eq('user_id', student.id)
        .maybeSingle();
      expect(groupMember).toBeTruthy();
    });

    it('rejects a used invite and keeps a removed member out (#256)', async () => {
      const fixture = await before({ role: 'manager', org: true });
      createdOrgIds.push(fixture.orgId!);
      const student = await createTestUser({ role: 'student' });
      const { memberRoleId } = await roleIds(fixture.orgId!);

      mockUser(fixture.user);
      const inviteRes = await invitePost(
        createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: student.email, targetOrgRoleId: memberRoleId }),
          },
          { active_org_id: fixture.orgId! },
        ),
      );
      expect(inviteRes.status).toBe(201);

      const supabase = createServiceClient();
      const { data: invite } = await supabase
        .from('invitations')
        .select('token')
        .eq('email', student.email)
        .eq('organization_id', fixture.orgId!)
        .single();
      expect(invite).toBeTruthy();

      const accept = () => {
        mockUser(student);
        return acceptPost(
          createNextRequest('http://localhost/api/v1/organization/invites/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: invite!.token }),
          }),
        );
      };

      // 1. First accept works as expected.
      const first = await accept();
      expect(first.status).toBe(200);

      // 2. Reusing the same token is rejected (was 200 before the fix).
      const second = await accept();
      const secondBody = await second.json();
      expect(second.status).toBe(410);
      expect(secondBody.success).toBe(false);

      // 3. Escalation: a removed member cannot re-join with the old token.
      await supabase
        .from('org_members')
        .delete()
        .eq('organization_id', fixture.orgId!)
        .eq('user_id', student.id);

      const third = await accept();
      const thirdBody = await third.json();
      expect(third.status).toBe(410);
      expect(thirdBody.success).toBe(false);

      const { data: membership } = await supabase
        .from('org_members')
        .select('user_id')
        .eq('organization_id', fixture.orgId!)
        .eq('user_id', student.id)
        .maybeSingle();
      expect(membership).toBeNull();

      const { data: consumed } = await supabase
        .from('invitations')
        .select('is_accepted')
        .eq('token', invite!.token)
        .single();
      expect(consumed?.is_accepted).toBe(true);
    });

    it('treats a legacy invitation with is_accepted = NULL as single-use (#256)', async () => {
      const fixture = await before({ role: 'manager', org: true });
      createdOrgIds.push(fixture.orgId!);
      const student = await createTestUser({ role: 'student' });
      const { memberRoleId } = await roleIds(fixture.orgId!);

      const supabase = createServiceClient();
      const token = `legacy-null-${copyId}-${Date.now()}`;
      // Pre-#256 rows carry `is_accepted = NULL` (the column default was never
      // backfilled). `.eq('is_accepted', false)` never matched them, so such a
      // token stayed replayable forever; the claim's `IS NOT TRUE` must consume
      // it exactly once.
      const { error } = await supabase.from('invitations').insert({
        email: student.email,
        target_org_role_id: memberRoleId,
        token,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        inviter_id: fixture.user.id,
        organization_id: fixture.orgId!,
        is_accepted: null,
      });
      if (error) throw new Error(`Failed to insert invitation: ${error.message}`);

      const accept = () => {
        mockUser(student);
        return acceptPost(
          createNextRequest('http://localhost/api/v1/organization/invites/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          }),
        );
      };

      expect((await accept()).status).toBe(200);

      const second = await accept();
      const body = await second.json();
      expect(second.status).toBe(410);
      expect(body.success).toBe(false);

      const { data: consumed } = await supabase
        .from('invitations')
        .select('is_accepted')
        .eq('token', token)
        .single();
      expect(consumed?.is_accepted).toBe(true);
    });

    it('does not let a different user replay an accepted token (#256)', async () => {
      const fixture = await before({ role: 'manager', org: true });
      createdOrgIds.push(fixture.orgId!);
      const student = await createTestUser({ role: 'student' });
      const other = await createTestUser({ role: 'student' });
      const { memberRoleId } = await roleIds(fixture.orgId!);

      mockUser(fixture.user);
      const inviteRes = await invitePost(
        createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: student.email, targetOrgRoleId: memberRoleId }),
          },
          { active_org_id: fixture.orgId! },
        ),
      );
      expect(inviteRes.status).toBe(201);

      const supabase = createServiceClient();
      const { data: invite } = await supabase
        .from('invitations')
        .select('token')
        .eq('email', student.email)
        .eq('organization_id', fixture.orgId!)
        .single();
      expect(invite).toBeTruthy();

      const acceptAs = (user: typeof student) => {
        mockUser(user);
        return acceptPost(
          createNextRequest('http://localhost/api/v1/organization/invites/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: invite!.token }),
          }),
        );
      };

      // The invited user consumes the bearer token; after that it is dead for
      // anyone else, so a third party holding a leaked/forwarded link cannot
      // join the organization with the invitee's role.
      expect((await acceptAs(student)).status).toBe(200);
      expect((await acceptAs(other)).status).toBe(410);

      const { count } = await supabase
        .from('org_members')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', fixture.orgId!)
        .eq('user_id', other.id);
      expect(count).toBe(0);
    });

    it('lets exactly one of two concurrent accepts claim the token (#256)', async () => {
      const fixture = await before({ role: 'manager', org: true });
      createdOrgIds.push(fixture.orgId!);
      const student = await createTestUser({ role: 'student' });
      const { memberRoleId } = await roleIds(fixture.orgId!);

      mockUser(fixture.user);
      const inviteRes = await invitePost(
        createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: student.email, targetOrgRoleId: memberRoleId }),
          },
          { active_org_id: fixture.orgId! },
        ),
      );
      expect(inviteRes.status).toBe(201);

      const supabase = createServiceClient();
      const { data: invite } = await supabase
        .from('invitations')
        .select('token')
        .eq('email', student.email)
        .eq('organization_id', fixture.orgId!)
        .single();
      expect(invite).toBeTruthy();

      mockUser(student);
      const accept = () =>
        acceptPost(
          createNextRequest('http://localhost/api/v1/organization/invites/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: invite!.token }),
          }),
        );

      // Both requests are started together; whichever reaches the claim first
      // wins and the other gets 410. A fully serialised run also yields
      // [200, 410] (the read check rejects the second), so this is a smoke test
      // for the race — the deterministic proof that the claim happens before any
      // membership write is the unit test "claims the token before writing
      // membership …" / "rejects the accept when the token was already claimed
      // concurrently (GONE)".
      const statuses = (await Promise.all([accept(), accept()])).map((r) => r.status).sort();
      expect(statuses).toEqual([200, 410]);

      const { count } = await supabase
        .from('org_members')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', fixture.orgId!)
        .eq('user_id', student.id);
      expect(count).toBe(1);
    });

    // End-to-end check for #182 (max_students was never enforced on accept). Note:
    // mockUser() uses a service-role client, so this cannot reproduce the RLS
    // blindness that caused it; that is covered by the unit test asserting the
    // count goes through the admin client.
    it('rejects the invite that would push the org over max_students (#182)', async () => {
      // Launch plan: max_students = 5 -> manager + 4 members fill the org
      const fixture = await before({ role: 'manager', org: true, members: { count: 4 } });
      createdOrgIds.push(fixture.orgId!);
      const extra = await createTestUser({ role: 'student' });
      const { memberRoleId } = await roleIds(fixture.orgId!);

      mockUser(fixture.user);
      const inviteRes = await invitePost(
        createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: extra.email, targetOrgRoleId: memberRoleId }),
          },
          { active_org_id: fixture.orgId! },
        ),
      );
      expect(inviteRes.status).toBe(201);

      const supabase = createServiceClient();
      const { data: invite } = await supabase
        .from('invitations')
        .select('token')
        .eq('email', extra.email)
        .eq('organization_id', fixture.orgId!)
        .single();

      mockUser(extra);
      const acceptRes = await acceptPost(
        createNextRequest('http://localhost/api/v1/organization/invites/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: invite!.token }),
        }),
      );
      expect(acceptRes.status).toBe(429);

      const { data: membership } = await supabase
        .from('org_members')
        .select('user_id')
        .eq('organization_id', fixture.orgId!)
        .eq('user_id', extra.id)
        .maybeSingle();
      expect(membership).toBeNull();
    });

    it('re-accepting as an existing member at the cap stays idempotent (#182)', async () => {
      // Org filled to max_students = 5 by the fixture itself (manager + 4 members).
      const fixture = await before({ role: 'manager', org: true, members: { count: 4 } });
      createdOrgIds.push(fixture.orgId!);
      const existing = fixture.memberUsers[0];
      const { memberRoleId } = await roleIds(fixture.orgId!);

      mockUser(fixture.user);
      const inviteRes = await invitePost(
        createNextRequest(
          'http://localhost/api/v1/organization/invites',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: existing.email, targetOrgRoleId: memberRoleId }),
          },
          { active_org_id: fixture.orgId! },
        ),
      );
      expect(inviteRes.status).toBe(201);

      const supabase = createServiceClient();
      const { data: invite } = await supabase
        .from('invitations')
        .select('token')
        .eq('email', existing.email)
        .eq('organization_id', fixture.orgId!)
        .eq('is_accepted', false)
        .order('expires_at', { ascending: false })
        .limit(1)
        .single();
      expect(invite).toBeTruthy();

      mockUser(existing);
      const acceptRes = await acceptPost(
        createNextRequest('http://localhost/api/v1/organization/invites/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: invite!.token }),
        }),
      );
      // The org is full, but the caller already occupies their seat: no 429, no
      // 409 from the (organization_id, user_id) / (group_id, user_id) uniques.
      expect(acceptRes.status).toBe(200);

      const { count } = await supabase
        .from('org_members')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', fixture.orgId!);
      expect(count).toBe(5);

      const { count: groupRows } = await supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', fixture.defaultGroupId!)
        .eq('user_id', existing.id);
      expect(groupRows).toBe(1);
    });
  });
});
