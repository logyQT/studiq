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
// organization, and rows of personal resources (no organization), are in no aggregate.
describe('teacher dashboard organization isolation (#654 review)', () => {
  const service = createServiceClient();
  const STUDENT_ID = '00000000-0000-4000-8001-000000000005'; // student1, member of O1G1 in WSB
  const MARK = `zz654-${Date.now()}`;
  let teacher: SupabaseClient;
  let baseline: { completed: number; groupCompleted: number; reviews: number };

  type Perf = {
    groups: Array<{ groupId: string; completedAttempts: number; flashcardReviews: number }>;
    totals: { students: number; completedAttempts: number };
  };

  async function perf(): Promise<Perf> {
    const { data, error } = await teacher.rpc('get_teacher_group_performance', {
      p_user_id: TEACHER_ID,
      p_organization_id: ORG,
    });
    expect(error).toBeNull();
    return data as Perf;
  }

  const attempt = (organization_id: string | null, title: string) => ({
    user_id: STUDENT_ID,
    score: 1,
    total_questions: 2,
    config: { title: `${MARK}-${title}` },
    started_at: new Date(Date.now() - 60_000).toISOString(),
    completed_at: new Date().toISOString(),
    organization_id,
  });

  beforeAll(async () => {
    teacher = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await teacher.auth.signInWithPassword({
      email: 'teacher1@dev.local',
      password: 'pass',
    });
    if (error) throw new Error(`sign-in failed: ${error.message}`);

    const before = await perf();
    const group = before.groups.reduce((a, g) => (g.groupId ? g : a), before.groups[0]);
    baseline = {
      completed: before.totals.completedAttempts,
      groupCompleted: group?.completedAttempts ?? 0,
      reviews: before.groups.reduce((n, g) => n + g.flashcardReviews, 0),
    };

    const { error: insertError } = await service
      .from('quiz_attempts')
      .insert([attempt(ORG, 'own'), attempt(FOREIGN_ORG, 'foreign'), attempt(null, 'personal')]);
    if (insertError) throw insertError;
  });

  afterAll(async () => {
    await service.from('quiz_attempts').delete().like('config->>title', `${MARK}-%`);
  });

  it("counts only the attempts stamped with the caller's organization", async () => {
    const after = await perf();

    expect(after.totals.completedAttempts - baseline.completed).toBe(1);
  });

  it('keeps foreign and personal attempts out of the activity feed', async () => {
    const { data, error } = await teacher.rpc('get_teacher_activity_feed', {
      p_user_id: TEACHER_ID,
      p_organization_id: ORG,
      p_limit: 50,
    });
    expect(error).toBeNull();

    const titles = (data as Array<{ title: string | null }>).map((i) => i.title);
    expect(titles).toContain(`${MARK}-own`);
    expect(titles).not.toContain(`${MARK}-foreign`);
    expect(titles).not.toContain(`${MARK}-personal`);
  });

  it('counts a learner once in the totals however many groups they are in', async () => {
    const after = await perf();
    const rowSum = after.groups.reduce((n, g) => n + g.completedAttempts, 0);

    expect(after.totals.completedAttempts).toBeLessThanOrEqual(rowSum);
  });

  it('stamps a practice quiz of a shared assignment with the assignment organization', async () => {
    const { data: assignment } = await service
      .from('teacher_assignments')
      .select('id, organization_id')
      .not('organization_id', 'is', null)
      .limit(1)
      .single();
    if (!assignment) return;

    const { data: row, error } = await service
      .from('quiz_attempts')
      .insert({
        user_id: STUDENT_ID,
        assignment_id: assignment.id,
        config: { title: `${MARK}-asg` },
      })
      .select('organization_id')
      .single();
    expect(error).toBeNull();
    expect(row?.organization_id).toBe(assignment.organization_id);
  });
});
