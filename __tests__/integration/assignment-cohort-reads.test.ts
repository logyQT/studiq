import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJson } from '#test/helpers/json';
import {
  cleanupOrganizationDeep,
  seedGroupMembership,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createTypedServiceClient } from '#test/integration/test-utils';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@studiq/server/types/database';

// #1171 slice 2 at the database boundary: the seal and the cohort rule are proved with REAL user
// JWTs against PostgREST — the exact path a hostile client uses. A service-role mock cannot hide a
// grant or a policy regression.

const PASSWORD = 'Seal1171!';
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface SeededOrg {
  org: { id: string; name: string };
  adminRoleId: string;
  teacherRoleId: string;
  memberRoleId: string;
  defaultGroupId: string;
}

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
}

describe('Sealed items and cohort-scoped assignment reads (#1171)', () => {
  const service = createTypedServiceClient();

  let orgId: string;
  let groupA: string;
  let managerAssignmentId: string;
  let assignmentId: string;
  let educatorAssignmentId: string;
  let questionId: string;
  let question2Id: string;
  let optionId: string;
  let deadline: string;
  const userIds: string[] = [];
  let studentA: SupabaseClient<Database>;
  let studentB: SupabaseClient<Database>;
  let teacher: SupabaseClient<Database>;
  let manager: SupabaseClient<Database>;
  let customMember: SupabaseClient<Database>;
  let colleague: SupabaseClient<Database>;

  async function createUser(label: string, accountType: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email: `seal-${label}-${tag}@dev.local`,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { account_type: accountType },
      user_metadata: { name: label, account_type: accountType },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    userIds.push(data.user.id);
    return data.user.id;
  }

  beforeAll(async () => {
    const seeded = asJson<SeededOrg>(await seedOrganization(`seal-${tag}`));
    orgId = seeded.org.id;

    const teacherId = await createUser('teacher', 'educator');
    const managerId = await createUser('manager', 'manager');
    const studentAId = await createUser('student-a', 'student');
    const studentBId = await createUser('student-b', 'student');
    const colleagueId = await createUser('colleague', 'educator');
    await seedOrgMembership({
      organizationId: orgId,
      userId: teacherId,
      orgRoleId: seeded.teacherRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: managerId,
      orgRoleId: seeded.adminRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: studentAId,
      orgRoleId: seeded.memberRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: studentBId,
      orgRoleId: seeded.memberRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: colleagueId,
      orgRoleId: seeded.teacherRoleId,
    });

    // A custom role whose entitlement_profile defaults to 'none'. Its holder below is a
    // student persona on a non-staff, non-learner profile: an org-wide run must still seal
    // them (the safe direction — the pre-5e-1 code sealed any non-staff persona).
    const { data: customRole, error: customRoleError } = await service
      .from('org_roles')
      .insert({
        organization_id: orgId,
        name: `seal-custom-${tag}`,
        display_name: 'Custom',
        is_system: false,
      })
      .select('id')
      .single();
    if (customRoleError) throw new Error(`custom role: ${customRoleError.message}`);
    const customMemberId = await createUser('custom-member', 'student');
    await seedOrgMembership({
      organizationId: orgId,
      userId: customMemberId,
      orgRoleId: customRole.id,
    });

    const { data: group, error: groupError } = await service
      .from('groups')
      .insert({ organization_id: orgId, name: `seal-8a-${tag}` })
      .select('id')
      .single();
    if (groupError) throw new Error(`group: ${groupError.message}`);
    groupA = group.id;
    await seedGroupMembership({ groupId: groupA, userId: studentAId, role: 'member' });
    // The QA-seeder shape: the author sits in the targeted group as a plain `member`, so arm 2
    // would seal their own item unless the author exemption (R4, #1172) holds.
    await seedGroupMembership({ groupId: groupA, userId: teacherId, role: 'member' });
    await seedGroupMembership({ groupId: groupA, userId: colleagueId, role: 'member' });

    // A second run that targets the manager: staff in a targeted group are readers, not students,
    // so a seal computed for them would be a regression the read tests must catch.
    const { data: managerGroup, error: managerGroupError } = await service
      .from('groups')
      .insert({ organization_id: orgId, name: `seal-staff-${tag}` })
      .select('id')
      .single();
    if (managerGroupError) throw new Error(`manager group: ${managerGroupError.message}`);
    await seedGroupMembership({ groupId: managerGroup.id, userId: managerId, role: 'teacher' });

    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        name: `seal-bank-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError) throw new Error(`bank: ${bankError.message}`);

    const { data: question, error: questionError } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        bank_id: bank.id,
        type: 'mcq',
        content: `seal-question-${tag}`,
        explanation: `seal-explanation-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (questionError) throw new Error(`question: ${questionError.message}`);
    questionId = question.id;

    // A second item bound only to a run that targets the teacher directly: persona (educator)
    // and target (learner) disagree, so this row is the R28 fixture for the seal (D-5e1).
    const { data: question2, error: question2Error } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        bank_id: bank.id,
        type: 'mcq',
        content: `seal-question2-${tag}`,
        explanation: `seal-explanation2-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (question2Error) throw new Error(`question2: ${question2Error.message}`);
    question2Id = question2.id;

    const { data: options, error: optionError } = await service
      .from('question_options')
      .insert([
        { question_id: questionId, content: 'correct', is_correct: true, order_index: 0 },
        { question_id: questionId, content: 'wrong', is_correct: false, order_index: 1 },
      ])
      .select('id');
    if (optionError) throw new Error(`options: ${optionError.message}`);
    optionId = options[0]!.id;

    deadline = new Date(Date.now() + 86_400_000).toISOString();
    const { data: assignment, error: assignmentError } = await service
      .from('teacher_assignments')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        title: `seal-assignment-${tag}`,
        status: 'published',
        deadline,
        start_time: null,
      })
      .select('id')
      .single();
    if (assignmentError) throw new Error(`assignment: ${assignmentError.message}`);
    assignmentId = assignment.id;

    await service.from('assignment_questions').insert({
      assignment_id: assignmentId,
      question_id: questionId,
      order_index: 0,
      points: 1,
      snapshot: {
        id: questionId,
        content: `seal-question-${tag}`,
        type: 'mcq',
        question_answers: [],
      },
      snapshot_key: { explanation: 'sealed', correctOptionIds: [optionId] },
      snapshot_version: 1,
    });
    await service
      .from('assignment_targets')
      .insert({ assignment_id: assignmentId, group_id: groupA });

    const { data: managerAssignment, error: managerAssignmentError } = await service
      .from('teacher_assignments')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        title: `seal-staff-assignment-${tag}`,
        status: 'published',
        deadline,
        start_time: null,
      })
      .select('id')
      .single();
    if (managerAssignmentError)
      throw new Error(`manager assignment: ${managerAssignmentError.message}`);
    managerAssignmentId = managerAssignment.id;
    await service.from('assignment_questions').insert({
      assignment_id: managerAssignmentId,
      question_id: questionId,
      order_index: 0,
      points: 1,
      snapshot: {
        id: questionId,
        content: `seal-question-${tag}`,
        type: 'mcq',
        question_answers: [],
      },
      snapshot_key: { explanation: 'sealed', correctOptionIds: [optionId] },
      snapshot_version: 1,
    });
    await service
      .from('assignment_targets')
      .insert({ assignment_id: managerAssignmentId, group_id: managerGroup.id });

    // The run that targets an educator directly (student_id target): persona (educator) and
    // target (learner) disagree, so this row is the R28 fixture for the seal (D-5e1). The
    // target is the colleague, not the author, so the row-4 invariant (a targeted educator who
    // is not the author is held) and the author exemption (R4, #1172) are one fixture apart.
    const { data: educatorAssignment, error: educatorAssignmentError } = await service
      .from('teacher_assignments')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        title: `seal-educator-assignment-${tag}`,
        status: 'published',
        deadline,
        start_time: null,
      })
      .select('id')
      .single();
    if (educatorAssignmentError)
      throw new Error(`educator assignment: ${educatorAssignmentError.message}`);
    educatorAssignmentId = educatorAssignment.id;
    await service.from('assignment_questions').insert({
      assignment_id: educatorAssignmentId,
      question_id: question2Id,
      order_index: 0,
      points: 1,
      snapshot: {
        id: question2Id,
        content: `seal-question2-${tag}`,
        type: 'mcq',
        question_answers: [],
      },
      snapshot_key: { explanation: 'sealed', correctOptionIds: [optionId] },
      snapshot_version: 1,
    });
    await service
      .from('assignment_targets')
      .insert({ assignment_id: educatorAssignmentId, student_id: colleagueId });

    studentA = await signIn(`seal-student-a-${tag}@dev.local`);
    studentB = await signIn(`seal-student-b-${tag}@dev.local`);
    teacher = await signIn(`seal-teacher-${tag}@dev.local`);
    manager = await signIn(`seal-manager-${tag}@dev.local`);
    customMember = await signIn(`seal-custom-member-${tag}@dev.local`);
    colleague = await signIn(`seal-colleague-${tag}@dev.local`);
  });

  afterAll(async () => {
    await service.from('teacher_assignments').delete().eq('organization_id', orgId);
    await service.from('questions').delete().eq('organization_id', orgId);
    await service.from('question_banks').delete().eq('organization_id', orgId);
    await cleanupOrganizationDeep(orgId);
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  it('hides the live item set from the targeted student', async () => {
    const links = await studentA
      .from('assignment_questions')
      .select('question_id, snapshot')
      .eq('assignment_id', assignmentId);
    expect(links.error, 'no error — the rows are filtered, not refused').toBeNull();
    expect(links.data, 'the published item set is staff-only').toEqual([]);

    // The cohort is visible to itself, so the student can still resolve the run they were given.
    const targets = await studentA
      .from('assignment_targets')
      .select('group_id, student_id')
      .eq('assignment_id', assignmentId);
    expect(targets.error).toBeNull();
    expect(targets.data).toEqual([{ group_id: groupA, student_id: null }]);
  });

  it('hides another class’s item set and target list entirely', async () => {
    const links = await studentB
      .from('assignment_questions')
      .select('question_id')
      .eq('assignment_id', assignmentId);
    expect(links.error).toBeNull();
    expect(links.data).toEqual([]);

    const targets = await studentB
      .from('assignment_targets')
      .select('group_id, student_id')
      .eq('assignment_id', assignmentId);
    expect(targets.error).toBeNull();
    expect(targets.data).toEqual([]);
  });

  it('keeps the class view for the author, an educator and a manager', async () => {
    for (const [label, session] of [
      ['teacher', teacher],
      ['manager', manager],
    ] as const) {
      const links = await session
        .from('assignment_questions')
        .select('question_id, snapshot_version')
        .eq('assignment_id', assignmentId);
      expect(links.error, `${label} reads the frozen item set`).toBeNull();
      expect(links.data).toEqual([{ question_id: questionId, snapshot_version: 1 }]);

      const targets = await session
        .from('assignment_targets')
        .select('group_id')
        .eq('assignment_id', assignmentId);
      expect(targets.data, `${label} sees the cohort`).toEqual([{ group_id: groupA }]);
    }
  });

  it('serves no stem, option or key for the sealed item to the targeted student', async () => {
    const sealedQuestion = await studentA
      .from('questions')
      .select('id, content')
      .eq('id', questionId);
    expect(sealedQuestion.error, 'the row is filtered, not refused').toBeNull();
    expect(sealedQuestion.data).toEqual([]);

    const sealedOptions = await studentA
      .from('question_options')
      .select('id, content')
      .eq('question_id', questionId);
    expect(sealedOptions.error).toBeNull();
    expect(sealedOptions.data).toEqual([]);

    const rpc = await studentA.rpc('get_accessible_questions', {
      p_user_id: (await studentA.auth.getUser()).data.user!.id,
      p_org_id: orgId,
      p_scope: 'group',
    });
    expect(rpc.error?.code, 'the legacy content RPC stays unavailable').toBe('42501');
  });

  it('keeps the item readable for a student outside the window and for staff', async () => {
    const otherClass = await studentB.from('questions').select('id, content').eq('id', questionId);
    expect(otherClass.error).toBeNull();
    expect(otherClass.data).toEqual([{ id: questionId, content: `seal-question-${tag}` }]);

    const staff = await teacher.from('questions').select('id, content').eq('id', questionId);
    expect(staff.data).toEqual([{ id: questionId, content: `seal-question-${tag}` }]);

    // Targeted *and* staff: the run holds the item from its students, not from the class view.
    const targetedStaff = await manager.from('questions').select('id').eq('id', questionId);
    expect(targetedStaff.data, 'a targeted manager is still a reader').toEqual([
      { id: questionId },
    ]);
  });

  it('holds an org-wide run from every non-staff profile in the org, and from no org staff', async () => {
    await service
      .from('teacher_assignments')
      .update({ seal_org_wide: true })
      .eq('id', managerAssignmentId);

    const held = await studentB.from('questions').select('id').eq('id', questionId);
    expect(held.error).toBeNull();
    expect(held.data, 'a student outside the class is sealed by the org-wide run').toEqual([]);

    const memberHeld = await studentA.from('questions').select('id').eq('id', questionId);
    expect(memberHeld.data, 'a learner-profile member is sealed org-wide, targeted or not').toEqual(
      [],
    );

    const customHeld = await customMember.from('questions').select('id').eq('id', questionId);
    expect(
      customHeld.data,
      'a custom-role (none profile) member is sealed org-wide too — persona/role disagree (R28)',
    ).toEqual([]);

    // Org staff (Admin/Teacher roles, entitlement_profile 'all') are not learners: the org-wide
    // run holds the item from non-staff profiles only (D-5e1, arm 3).
    const managerReads = await manager.from('questions').select('id').eq('id', questionId);
    expect(managerReads.data, 'org-wide does not seal the org admin').toEqual([{ id: questionId }]);
    const teacherReads = await teacher.from('questions').select('id').eq('id', questionId);
    expect(teacherReads.data, 'org-wide does not seal the org teacher').toEqual([
      { id: questionId },
    ]);

    await service
      .from('teacher_assignments')
      .update({ seal_org_wide: false })
      .eq('id', managerAssignmentId);
  });

  it('seals a directly targeted educator who is not the author, and spares the author (R28, R4)', async () => {
    const sealed = await colleague.from('questions').select('id').eq('id', question2Id);
    expect(sealed.error, 'the row is filtered, not refused').toBeNull();
    expect(
      sealed.data,
      'a directly targeted educator who is not the author is a learner by data',
    ).toEqual([]);

    const author = await teacher.from('questions').select('id').eq('id', question2Id);
    expect(author.error).toBeNull();
    expect(author.data, 'the run’s author is not sealed by their own run (R4, #1172)').toEqual([
      { id: question2Id },
    ]);

    const untargeted = await studentB.from('questions').select('id').eq('id', question2Id);
    expect(untargeted.error).toBeNull();
    expect(untargeted.data, 'a student persona that is not targeted is not sealed').toEqual([
      { id: question2Id },
    ]);
  });

  it('reads the item as the author who is a member of the targeted group, while a colleague member is held (R28, R4)', async () => {
    // The author sits in the targeted group as a `member` (the QA-seeder shape): without the
    // author exemption, arm 2 would hide the author's own item.
    const authorRead = await teacher.from('questions').select('id, content').eq('id', questionId);
    expect(authorRead.error).toBeNull();
    expect(authorRead.data, 'an assignment never seals its own author').toEqual([
      { id: questionId, content: `seal-question-${tag}` },
    ]);

    const colleagueRead = await colleague
      .from('questions')
      .select('id, content')
      .eq('id', questionId);
    expect(colleagueRead.error, 'the row is filtered, not refused').toBeNull();
    expect(colleagueRead.data, 'a non-author member of the targeted group is still held').toEqual(
      [],
    );
  });

  it('releases the item at close', async () => {
    await service
      .from('teacher_assignments')
      .update({ deadline: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', assignmentId);

    const released = await studentA.from('questions').select('id, content').eq('id', questionId);
    expect(released.data, 'once the window closes the item is readable again').toEqual([
      { id: questionId, content: `seal-question-${tag}` },
    ]);

    await service.from('teacher_assignments').update({ deadline }).eq('id', assignmentId);
  });
});
