import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type BeforeResult,
  before,
  createTestUser,
  randomTag,
  seedViaApi,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  cleanupFlashcardDecks,
  cleanupFlashcardPractice,
  cleanupFlashcards,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import { POST as logPractice } from '@/app/(backend)/api/v1/flashcards/[id]/practice/route';
import { GET as getTeacherStats } from '@/app/(backend)/api/v1/flashcards/stats/teacher/route';

/**
 * Regression coverage for #460 (EDU-ST-01). `get_teacher_stats` reported the
 * number of distinct users who had practised under the labels "Wszyscy
 * uczniowie" / "Studenci", so a fresh organization with one enrolled student
 * rendered 0 and a teacher practising their own deck incremented the count.
 *
 * The RPC now returns two numbers:
 *   - `practicingStudents`: distinct practisers, caller excluded;
 *   - `rosterStudents`: distinct learners in the caller's groups of the active
 *     organization, `null` when there is no active organization.
 *
 * `rosterStudents` must survive the empty-card path: a brand-new organization
 * has no flashcards yet, which is exactly when the class size matters.
 *
 * Learners are enrolled straight through the service client: the API group
 * endpoint is gated on the `group.manage` feature, which a freshly created
 * educator organization does not hold — the fixture would otherwise fail for
 * a reason unrelated to this RPC.
 */

const PASSWORD = 'Seed4Test!';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface StatsPayload {
  summary: {
    totalFlashcards: number;
    practicingStudents: number;
    rosterStudents: number | null;
  };
}

function newClient(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe('Teacher stats roster (#460)', () => {
  const tag = randomTag(6);
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let orgB!: BeforeResult;
  let emptyOrg!: BeforeResult;
  let solo!: BeforeResult;
  let removal!: BeforeResult;

  const learners: Record<'teacher' | 'orgB' | 'emptyOrg' | 'removal', TestUserFixture[]> = {
    teacher: [],
    orgB: [],
    emptyOrg: [],
    removal: [],
  };

  async function addLearner(orgId: string | null, groupId: string | null) {
    if (!orgId || !groupId) throw new Error('[setup] fixture has no organization/group');
    const user = await createTestUser({ role: 'student' });
    const { data: memberRole, error: roleError } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    if (roleError || !memberRole) throw new Error('[setup] member role not found');

    const { error: memberError } = await service.from('org_members').insert({
      organization_id: orgId,
      user_id: user.id,
      org_role_id: memberRole.id,
    });
    if (memberError) throw new Error(`[setup] org member insert: ${memberError.message}`);

    const { error: groupError } = await service.from('group_members').insert({
      group_id: groupId,
      user_id: user.id,
      role: 'member',
    });
    if (groupError) throw new Error(`[setup] group member insert: ${groupError.message}`);
    return user;
  }

  function fixtureUsers(): TestUserFixture[] {
    return [
      teacher?.user,
      orgB?.user,
      emptyOrg?.user,
      solo?.user,
      removal?.user,
      ...learners.teacher,
      ...learners.orgB,
      ...learners.emptyOrg,
      ...learners.removal,
    ].filter((u): u is TestUserFixture => Boolean(u));
  }

  async function fetchStats(owner: BeforeResult, orgId: string | null): Promise<StatsPayload> {
    mockUser(owner.user);
    const res = await getTeacherStats(
      createNextRequest(
        'http://localhost/api/v1/flashcards/stats/teacher',
        undefined,
        orgId ? { active_org_id: orgId } : {},
      ),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    return body.data as StatsPayload;
  }

  async function insertPractice(userId: string, flashcardId: string) {
    const { error } = await service.from('flashcard_practice').insert({
      user_id: userId,
      flashcard_id: flashcardId,
      was_correct: true,
    });
    expect(error).toBeNull();
  }

  beforeAll(async () => {
    teacher = await before({
      role: 'educator',
      org: `st460-a-${tag}`,
      decks: 1,
      flashcards: 1,
    });
    learners.teacher = [
      await addLearner(teacher.orgId, teacher.defaultGroupId),
      await addLearner(teacher.orgId, teacher.defaultGroupId),
    ];

    orgB = await seedViaApi(teacher.user, { org: `st460-b-${tag}` });
    learners.orgB = [await addLearner(orgB.orgId, orgB.defaultGroupId)];

    emptyOrg = await before({ role: 'educator', org: `st460-empty-${tag}` });
    learners.emptyOrg = [
      await addLearner(emptyOrg.orgId, emptyOrg.defaultGroupId),
      await addLearner(emptyOrg.orgId, emptyOrg.defaultGroupId),
    ];

    solo = await before({ role: 'educator' });

    removal = await before({
      role: 'educator',
      org: `st460-rm-${tag}`,
      decks: 1,
      flashcards: 1,
    });
    learners.removal = [await addLearner(removal.orgId, removal.defaultGroupId)];
  });

  beforeEach(async () => {
    for (const user of fixtureUsers()) {
      await cleanupFlashcardPractice(user.id);
    }
  });

  afterAll(async () => {
    for (const user of fixtureUsers()) {
      await cleanupFlashcardPractice(user.id);
      await cleanupFlashcards(user.id);
      await cleanupFlashcardDecks(user.id);
    }
    for (const orgId of [teacher?.orgId, orgB?.orgId, emptyOrg?.orgId, removal?.orgId]) {
      if (orgId) await cleanupOrganizationDeep(orgId);
    }
  });

  it('returns the class roster and only the students who practised', async () => {
    const baseline = await fetchStats(teacher, teacher.orgId);
    // Fresh org, one card, two enrolled students, zero practices.
    expect(baseline.summary.rosterStudents).toBe(2);
    expect(baseline.summary.practicingStudents).toBe(0);

    await insertPractice(learners.teacher[0].id, teacher.created.flashcards[0]);

    const after = await fetchStats(teacher, teacher.orgId);
    expect(after.summary.rosterStudents).toBe(2);
    expect(after.summary.practicingStudents).toBe(1);
  });

  it('counts a student who belongs to two groups once', async () => {
    const { data: secondGroup, error } = await service
      .from('groups')
      .insert({ organization_id: teacher.orgId, name: `st460-second-${tag}` })
      .select('id')
      .single();
    expect(error).toBeNull();

    const { error: memberError } = await service.from('group_members').insert({
      group_id: secondGroup?.id as string,
      user_id: learners.teacher[1].id,
      role: 'member',
    });
    expect(memberError).toBeNull();

    const stats = await fetchStats(teacher, teacher.orgId);
    expect(stats.summary.rosterStudents).toBe(2);
  });

  it('keeps the practice count when the student is removed from the org', async () => {
    const student = learners.removal[0];

    await insertPractice(student.id, removal.created.flashcards[0]);

    const beforeRemoval = await fetchStats(removal, removal.orgId);
    expect(beforeRemoval.summary.rosterStudents).toBe(1);
    expect(beforeRemoval.summary.practicingStudents).toBe(1);

    // The trigger on org_members removes the membership row from group_members.
    const { error } = await service
      .from('org_members')
      .delete()
      .eq('organization_id', removal.orgId as string)
      .eq('user_id', student.id);
    expect(error).toBeNull();

    const afterRemoval = await fetchStats(removal, removal.orgId);
    // The roster row is gone; the practice row survives — the matrix the issue
    // pins as (0, 1).
    expect(afterRemoval.summary.rosterStudents).toBe(0);
    expect(afterRemoval.summary.practicingStudents).toBe(1);
  });

  it('does not count the teacher practising their own deck', async () => {
    const flashcardId = teacher.created.flashcards[0];
    mockUser(teacher.user);

    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
      { id: flashcardId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wasCorrect: true }),
      },
    );
    const response = await logPractice(request, { params });
    expect(response.status).toBe(201);

    const stats = await fetchStats(teacher, teacher.orgId);
    expect(stats.summary.practicingStudents).toBe(0);
    expect(stats.summary.rosterStudents).toBe(2);
  });

  it('returns the roster from the empty-card path instead of a zero summary', async () => {
    const noCards = await fetchStats(emptyOrg, emptyOrg.orgId);
    expect(noCards.summary.totalFlashcards).toBe(0);
    expect(noCards.summary.rosterStudents).toBe(2);
  });

  it('returns a null roster for a teacher without an active organization', async () => {
    const stats = await fetchStats(solo, null);
    expect(stats.summary.rosterStudents).toBeNull();
    expect(stats.summary.practicingStudents).toBe(0);
  });

  it('follows the active organization for a multi-org teacher', async () => {
    const inOrgA = await fetchStats(teacher, teacher.orgId);
    expect(inOrgA.summary.rosterStudents).toBe(2);

    const inOrgB = await fetchStats(teacher, orgB.orgId);
    expect(inOrgB.summary.rosterStudents).toBe(1);
  });

  it('rejects a cross-tenant org id and a foreign user id over a real session', async () => {
    const member = learners.teacher[0];
    const session = newClient();
    const { error: signInError } = await session.auth.signInWithPassword({
      email: member.email,
      password: PASSWORD,
    });
    expect(signInError).toBeNull();

    // A crafted org id from another tenant must not leak its roster...
    const crossTenant = await session.rpc('get_teacher_stats', {
      p_flashcard_ids: [] as string[],
      p_user_id: member.id,
      p_organization_id: orgB.orgId,
    });
    expect(crossTenant.error).toBeNull();
    expect((crossTenant.data as StatsPayload).summary.rosterStudents).toBeNull();

    // ...while the caller's own org is allowed (2 learners minus the caller).
    const ownOrg = await session.rpc('get_teacher_stats', {
      p_flashcard_ids: [] as string[],
      p_user_id: member.id,
      p_organization_id: teacher.orgId,
    });
    expect(ownOrg.error).toBeNull();
    expect((ownOrg.data as StatsPayload).summary.rosterStudents).toBe(1);

    // Asking for another user's dashboard still fails.
    const foreignUser = await session.rpc('get_teacher_stats', {
      p_flashcard_ids: [] as string[],
      p_user_id: teacher.user.id,
      p_organization_id: teacher.orgId,
    });
    expect(foreignUser.error?.code).toBe('42501');

    // anon still has no EXECUTE grant.
    const anonResult = await newClient().rpc('get_teacher_stats', {
      p_flashcard_ids: [teacher.created.flashcards[0]],
      p_user_id: teacher.user.id,
    });
    expect(anonResult.error?.code).toBe('42501');
  });
});
