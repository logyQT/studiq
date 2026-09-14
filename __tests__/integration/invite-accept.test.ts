import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  POST as acceptPost,
} from '@/app/(backend)/api/v1/organization/invites/accept/route';
import {
  POST as bulkPost,
} from '@/app/(backend)/api/v1/organization/invites/bulk/route';
import { POST as invitePost } from '@/app/(backend)/api/v1/organization/invites/route';
import { before, createTestUser } from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';

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
      const req = createNextRequest('http://localhost/api/v1/organization/invites/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitations: [
            { email: `bulk-${copyId}-${Date.now()}@example.com`, targetOrgRoleId: memberRoleId },
            { email: `bulk-${copyId}-${Date.now()}-2@example.com`, targetOrgRoleId: memberRoleId },
          ],
        }),
      }, { active_org_id: fixture.orgId! });

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
      const inviteReq = createNextRequest('http://localhost/api/v1/organization/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: student.email,
          targetOrgRoleId: memberRoleId,
        }),
      }, { active_org_id: fixture.orgId! });
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
  });
});
