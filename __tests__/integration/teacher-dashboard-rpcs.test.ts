import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// #654: get_teacher_group_performance / get_teacher_activity_feed are SECURITY DEFINER (teachers
// cannot read other users' flashcard_practice through RLS), so they must not be a cross-user or
// cross-tenant oracle. Real seed users sign in with the anon key, the path a browser takes.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const TEACHER_ID = '00000000-0000-4000-8001-000000000003'; // teacher1@dev.local
const OTHER_USER_ID = '00000000-0000-4000-8001-000000000001';
const ORG = '00000000-0000-4000-8000-000000000001'; // WSB Merito, teacher1 is a member
const FOREIGN_ORG = '00000000-0000-4000-8000-00000000000e'; // Akademia Górnicza: teacher1 is not a member

describe('teacher dashboard RPCs (#654)', () => {
  let teacher: SupabaseClient;

  beforeAll(async () => {
    teacher = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await teacher.auth.signInWithPassword({
      email: 'teacher1@dev.local',
      password: 'pass',
    });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
  });

  it.each(['get_teacher_group_performance', 'get_teacher_activity_feed'])(
    "%s answers for the caller's own organization",
    async (fn) => {
      const { data, error } = await teacher.rpc(fn, {
        p_user_id: TEACHER_ID,
        p_organization_id: ORG,
      });
      expect(error).toBeNull();
      // The feed is a list; the group results are { groups, totals }.
      expect(
        fn === 'get_teacher_group_performance' ? Array.isArray(data.groups) : Array.isArray(data),
      ).toBe(true);
    },
  );

  it('lists only groups the caller belongs to, with numbers in range', async () => {
    const { data } = await teacher.rpc('get_teacher_group_performance', {
      p_user_id: TEACHER_ID,
      p_organization_id: ORG,
    });
    for (const group of data.groups as Array<Record<string, number | null | string>>) {
      expect(typeof group.groupName).toBe('string');
      expect(group.students as number).toBeGreaterThanOrEqual(0);
      for (const key of ['avgScore', 'flashcardAccuracy'] as const) {
        const value = group[key] as number | null;
        if (value !== null) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it.each(['get_teacher_group_performance', 'get_teacher_activity_feed'])(
    '%s refuses to run for another user (42501)',
    async (fn) => {
      const { error } = await teacher.rpc(fn, {
        p_user_id: OTHER_USER_ID,
        p_organization_id: ORG,
      });
      expect(error?.code).toBe('42501');
    },
  );

  it.each(['get_teacher_group_performance', 'get_teacher_activity_feed'])(
    '%s returns nothing for an organization the caller is not in',
    async (fn) => {
      const { data, error } = await teacher.rpc(fn, {
        p_user_id: TEACHER_ID,
        p_organization_id: FOREIGN_ORG,
      });
      expect(error).toBeNull();
      expect(data).toEqual(
        fn === 'get_teacher_group_performance'
          ? { groups: [], totals: { students: 0, completedAttempts: 0, awaitingGrade: 0 } }
          : [],
      );
    },
  );
});

// Operator decision A2: switching into an organization shows only that organization's activity.
// A learner's attempts and reviews carry the organization of what was practised; rows of another
// organization, and rows of personal resources (no organization), are in no aggregate. Every
// fixture is built here, nothing depends on what the seed happens to contain.
describe('teacher dashboard organization isolation (#654 review)', () => {
  const service = createServiceClient();
  const STUDENT_ID = '00000000-0000-4000-8001-000000000005'; // student1, member of O1G1 in WSB
  const MARK = `zz654-${Date.now()}`;
  const BANK = '00000000-0000-4000-8020-000000000001';
  let teacher: SupabaseClient;
  let student: SupabaseClient;
  let secondGroupId: string;
  let ownAssignmentId: string;
  let foreignAssignmentId: string;
  let groupCardId: string;
  let baseline: Perf;

  type Perf = {
    groups: Array<{
      groupId: string;
      students: number;
      completedAttempts: number;
      awaitingGrade: number;
      flashcardReviews: number;
    }>;
    totals: { students: number; completedAttempts: number; awaitingGrade: number };
  };

  async function perf(): Promise<Perf> {
    const { data, error } = await teacher.rpc('get_teacher_group_performance', {
      p_user_id: TEACHER_ID,
      p_organization_id: ORG,
    });
    expect(error).toBeNull();
    return data as Perf;
  }

  async function feed() {
    const { data, error } = await teacher.rpc('get_teacher_activity_feed', {
      p_user_id: TEACHER_ID,
      p_organization_id: ORG,
      p_limit: 50,
    });
    expect(error).toBeNull();
    return data as Array<{ title: string | null; assignmentId: string | null; kind: string }>;
  }

  const signIn = async (email: string) => {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email, password: 'pass' });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
    return client;
  };

  const finished = (
    organization_id: string | null,
    config: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) => ({
    user_id: STUDENT_ID,
    score: 1,
    total_questions: 2,
    config: { marker: MARK, ...config },
    started_at: new Date(Date.now() - 60_000).toISOString(),
    completed_at: new Date().toISOString(),
    organization_id,
    ...extra,
  });

  beforeAll(async () => {
    [teacher, student] = await Promise.all([
      signIn('teacher1@dev.local'),
      signIn('student1@dev.local'),
    ]);
    baseline = await perf();

    // A learner in TWO groups of the same teacher: the distinct totals must not add them twice.
    const { data: group, error: groupError } = await service
      .from('groups')
      .insert({ organization_id: ORG, name: MARK, created_by: TEACHER_ID })
      .select('id')
      .single();
    if (groupError) throw groupError;
    secondGroupId = group.id;
    const { error: memberError } = await service.from('group_members').insert([
      { group_id: secondGroupId, user_id: TEACHER_ID, role: 'teacher' },
      { group_id: secondGroupId, user_id: STUDENT_ID, role: 'member' },
    ]);
    if (memberError) throw memberError;

    const { data: assignments, error: assignmentError } = await service
      .from('teacher_assignments')
      .insert([
        { created_by: TEACHER_ID, organization_id: ORG, title: `${MARK}-own-asg` },
        { created_by: TEACHER_ID, organization_id: FOREIGN_ORG, title: `${MARK}-foreign-asg` },
      ])
      .select('id, organization_id');
    if (assignmentError) throw assignmentError;
    ownAssignmentId = assignments!.find((a) => a.organization_id === ORG)!.id;
    foreignAssignmentId = assignments!.find((a) => a.organization_id === FOREIGN_ORG)!.id;

    const { error: attemptError } = await service.from('quiz_attempts').insert([
      finished(ORG, { title: `${MARK}-own` }),
      finished(FOREIGN_ORG, { title: `${MARK}-foreign` }),
      finished(null, { title: `${MARK}-personal` }),
      // submitted, not yet graded: reported apart, never averaged in as 0 %
      finished(null, {}, { assignment_id: ownAssignmentId }),
      // a practice quiz as the app really stores it: the generator request, no title
      finished(ORG, { bankId: BANK, questionCount: 2, questionTypes: ['mcq'] }),
    ]);
    if (attemptError) throw attemptError;

    const { data: card } = await service
      .from('flashcards')
      .select('id')
      .eq('organization_id', ORG)
      .eq('visibility', 'group')
      .limit(1)
      .single();
    groupCardId = card!.id;
    // two reviews of a group-shared card of this organization; one of them is then moved to the
    // foreign organization by the service role (a client never could), which must drop it
    const { data: reviews, error: reviewError } = await service
      .from('flashcard_practice')
      .insert([
        { user_id: STUDENT_ID, flashcard_id: groupCardId, was_correct: true },
        { user_id: STUDENT_ID, flashcard_id: groupCardId, was_correct: true },
      ])
      .select('id');
    if (reviewError) throw reviewError;
    await service
      .from('flashcard_practice')
      .update({ organization_id: FOREIGN_ORG })
      .eq('id', reviews![0].id);
  });

  afterAll(async () => {
    await service.from('quiz_attempts').delete().eq('config->>marker', MARK);
    await service
      .from('flashcard_practice')
      .delete()
      .eq('flashcard_id', groupCardId)
      .eq('user_id', STUDENT_ID)
      .gte('practiced_at', new Date(Date.now() - 600_000).toISOString());
    await service.from('teacher_assignments').delete().like('title', `${MARK}-%`);
    await service.from('groups').delete().eq('id', secondGroupId);
  });

  it("counts only the attempts stamped with the caller's organization", async () => {
    const after = await perf();

    // own + practice-with-bank + the ungraded assignment attempt; foreign and personal add nothing
    expect(after.totals.completedAttempts - baseline.totals.completedAttempts).toBe(3);
  });

  it('keeps ungraded assignment attempts out of the average and reports them apart', async () => {
    const after = await perf();

    expect(after.totals.awaitingGrade - baseline.totals.awaitingGrade).toBe(1);
  });

  it('counts a learner in two groups once: the totals are below the sum of the rows', async () => {
    const after = await perf();
    const rowSum = after.groups.reduce((n, g) => n + g.students, 0);
    const second = after.groups.find((g) => g.groupId === secondGroupId);

    expect(second?.students).toBe(1);
    expect(rowSum).toBeGreaterThan(after.totals.students);
    expect(after.totals.students).toBe(baseline.totals.students);
  });

  it('counts the reviews of this organization only', async () => {
    const after = await perf();
    const second = after.groups.find((g) => g.groupId === secondGroupId);

    // one review stayed in the organization, the other was moved to the foreign one
    expect(second?.flashcardReviews).toBe(1);
  });

  it('keeps foreign and personal attempts out of the activity feed', async () => {
    const titles = (await feed()).map((item) => item.title);

    expect(titles).toContain(`${MARK}-own`);
    expect(titles).not.toContain(`${MARK}-foreign`);
    expect(titles).not.toContain(`${MARK}-personal`);
  });

  it('names a real practice quiz after its bank instead of leaving it untitled', async () => {
    const titles = (await feed()).map((item) => item.title);

    expect(titles).toContain('O1G1T1');
  });

  it('stamps an assignment attempt with the assignment organization, whatever it came with', async () => {
    const { data, error } = await service
      .from('quiz_attempts')
      .insert(finished(FOREIGN_ORG, {}, { assignment_id: ownAssignmentId }))
      .select('organization_id')
      .single();

    expect(error).toBeNull();
    expect(data?.organization_id).toBe(ORG);
  });

  it('lets a client neither choose the stamp of its attempt nor move it afterwards', async () => {
    // the student writes through the same path a browser takes
    const { data: inserted, error } = await student
      .from('quiz_attempts')
      .insert({
        user_id: STUDENT_ID,
        total_questions: 1,
        config: { marker: MARK, title: `${MARK}-smuggled` },
        completed_at: new Date().toISOString(),
        organization_id: ORG,
      })
      .select('id, organization_id')
      .single();
    expect(error).toBeNull();
    expect(inserted?.organization_id).toBeNull();

    const { data: moved } = await student
      .from('quiz_attempts')
      .update({ organization_id: ORG })
      .eq('id', inserted!.id)
      .select('organization_id')
      .single();
    expect(moved?.organization_id).toBeNull();
    expect((await feed()).map((item) => item.title)).not.toContain(`${MARK}-smuggled`);
  });

  it('cannot smuggle a foreign assignment into the feed with a stamp alone', async () => {
    // a row stamped with this organization whose assignment is later pointed at a foreign one
    const { data, error } = await service
      .from('quiz_attempts')
      .insert(finished(ORG, { title: `${MARK}-pointer` }))
      .select('id')
      .single();
    expect(error).toBeNull();
    await service
      .from('quiz_attempts')
      .update({ assignment_id: foreignAssignmentId })
      .eq('id', data!.id);

    const items = await feed();
    expect(items.map((i) => i.assignmentId)).not.toContain(foreignAssignmentId);
    expect(items.map((i) => i.title)).not.toContain(`${MARK}-foreign-asg`);
  });
});
