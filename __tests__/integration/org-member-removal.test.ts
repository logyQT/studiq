import { AccountType, type RequestContext } from '@studiq/authz';
import { groupService } from '@studiq/server/services/group.service';
import { teacherAssignmentService } from '@studiq/server/services/teacher-assignment.service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
  seedGroupMembership,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';

/**
 * #249 (MGR-MEM-04): removing a member must end their group memberships, and a
 * stale `group_members` row must not grant access to org assignments either.
 *
 * The services run on the service-role client (`mockUser`), i.e. with RLS out of
 * the picture — exactly the condition the report is about: the gate has to hold
 * in the application/data layer, not because a policy happens to hide the rows.
 */
describe('Org member removal cleans group membership (#249)', () => {
  const service = createServiceClient();

  let orgId: string;
  let memberRoleId: string;
  let groupId: string;
  let studentId: string;
  let assignmentId: string;
  let ctx: RequestContext;

  beforeAll(async () => {
    const seeded = await seedOrganization(`org-removal-249-${Date.now()}`);
    orgId = seeded.org.id;
    memberRoleId = seeded.memberRoleId;

    const teacher = await createTestUser({ role: 'educator' });
    const student = await createTestUser({ role: 'student' });
    studentId = student.id;

    await seedOrgMembership({ organizationId: orgId, userId: teacher.id, orgRoleId: memberRoleId });
    await seedOrgMembership({ organizationId: orgId, userId: student.id, orgRoleId: memberRoleId });

    const { data: group, error: groupError } = await service
      .from('groups')
      .insert({ organization_id: orgId, name: `O1G1-249-${Date.now()}` })
      .select('id')
      .single();
    if (groupError || !group) throw new Error(`[setup] group: ${groupError?.message}`);
    groupId = group.id;
    await seedGroupMembership({ groupId, userId: student.id, role: 'member' });

    const { data: assignment, error: assignmentError } = await service
      .from('teacher_assignments')
      .insert({
        organization_id: orgId,
        created_by: teacher.id,
        title: 'QA MGR-MEM-04 assignment',
        status: 'published',
      })
      .select('id')
      .single();
    if (assignmentError || !assignment) {
      throw new Error(`[setup] assignment: ${assignmentError?.message}`);
    }
    assignmentId = assignment.id;

    const { error: targetError } = await service
      .from('assignment_targets')
      .insert({ assignment_id: assignmentId, group_id: groupId });
    if (targetError) throw new Error(`[setup] assignment target: ${targetError.message}`);

    // The removed user keeps a stale active_org_id cookie in the real app.
    ctx = {
      userId: student.id,
      accountType: AccountType.STUDENT,
      traceId: 'issue-249',
      url: '',
      method: 'GET',
      activeOrgId: orgId,
      orgRoleId: memberRoleId,
      groupIds: [groupId],
      permissionScopes: {},
    };

    mockUser(student);
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('deletes the group memberships of the leaving org on org_members delete', async () => {
    const { error } = await service.from('org_members').delete().eq('user_id', studentId);
    expect(error).toBeNull();

    const { data: memberships } = await service
      .from('group_members')
      .select('group_id')
      .eq('user_id', studentId);
    expect(memberships).toEqual([]);
  });

  it('does not authorize a stale group membership after removal', async () => {
    // Emulate legacy data written before the trigger existed (and proves the
    // app-level gate works on its own).
    await seedGroupMembership({ groupId, userId: studentId, role: 'member' });

    const listed = await teacherAssignmentService.listForStudent(ctx);
    expect(listed.success).toBe(true);
    if (listed.success) expect(listed.data).toEqual([]);

    const single = await teacherAssignmentService.getForStudent(assignmentId, ctx);
    expect(single.success).toBe(false);
    if (!single.success) expect(single.error).toBe('NOT_FOUND');

    const groups = await groupService.listMyGroups(ctx);
    expect(groups.success).toBe(true);
    if (groups.success) {
      expect(groups.data.map((g) => g.id)).not.toContain(groupId);
    }
  });

  it('grants access again once the user is a member of the org', async () => {
    await seedOrgMembership({ organizationId: orgId, userId: studentId, orgRoleId: memberRoleId });

    const listed = await teacherAssignmentService.listForStudent(ctx);
    expect(listed.success).toBe(true);
    if (listed.success) expect(listed.data.map((a) => a.id)).toContain(assignmentId);

    const single = await teacherAssignmentService.getForStudent(assignmentId, ctx);
    expect(single.success).toBe(true);

    const groups = await groupService.listMyGroups(ctx);
    expect(groups.success).toBe(true);
    if (groups.success) expect(groups.data.map((g) => g.id)).toContain(groupId);
  });
});
