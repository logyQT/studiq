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
  // `get_teacher_group_performance` counts every review of a learner in the organization for each
  // of their groups, so the per-group number is only a delta on a shared database.
  let secondGroupReviewBaseline = 0;
  let foreignBankId: string;
  let foreignQuestionId: string;
  let foreignQuestionReportId: string;
  let forgedReportId: string;
  let groupReportId: string;
  let positiveQuestionId: string;
  let positiveReportId: string;
  let mixedQuestionIds: string[] = [];
  let stampQuestionIds: string[] = [];
  const restampPracticeIds: string[] = [];
  const restampCardIds: string[] = [];
  const restampDeckIds: string[] = [];
  const scopeQuestionIds: string[] = [];

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
    return data as Array<{
      at: string;
      title: string | null;
      personName: string | null;
      assignmentId: string | null;
      kind: string;
      needsGrading: boolean;
      questionId: string | null;
    }>;
  }

  async function stampOf(attemptId: string) {
    const { data, error } = await service
      .from('quiz_attempts')
      .select('organization_id')
      .eq('id', attemptId)
      .single();
    if (error) throw error;
    return data.organization_id;
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

    // Before the reviews below are written: the number is asserted as a delta so a non-pristine
    // database (other tests' practice rows) cannot fail the run.
    secondGroupReviewBaseline =
      (await perf()).groups.find((g) => g.groupId === secondGroupId)?.flashcardReviews ?? 0;

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
    const reportIds = [
      foreignQuestionReportId,
      forgedReportId,
      groupReportId,
      positiveReportId,
    ].filter(Boolean);
    if (reportIds.length > 0) {
      await service.from('question_reports').delete().in('id', reportIds);
    }
    const questionIds = [
      foreignQuestionId,
      positiveQuestionId,
      ...mixedQuestionIds,
      ...stampQuestionIds,
      ...scopeQuestionIds,
    ].filter(Boolean);
    if (questionIds.length > 0) {
      await service.from('questions').delete().in('id', questionIds);
    }
    if (foreignBankId) {
      await service.from('question_banks').delete().eq('id', foreignBankId);
    }
    await service.from('quiz_attempts').delete().eq('config->>marker', MARK);
    await service
      .from('flashcard_practice')
      .delete()
      .eq('flashcard_id', groupCardId)
      .eq('user_id', STUDENT_ID)
      .gte('practiced_at', new Date(Date.now() - 600_000).toISOString());
    const practiceIds = restampPracticeIds.filter(Boolean);
    if (practiceIds.length > 0) {
      await service.from('flashcard_practice').delete().in('id', practiceIds);
    }
    const cardIds = restampCardIds.filter(Boolean);
    if (cardIds.length > 0) {
      await service.from('flashcards').delete().in('id', cardIds);
    }
    const deckIds = restampDeckIds.filter(Boolean);
    if (deckIds.length > 0) {
      await service.from('flashcard_decks').delete().in('id', deckIds);
    }
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
    expect((second?.flashcardReviews ?? 0) - secondGroupReviewBaseline).toBe(1);
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

  it('never excerpts or names a reported question outside the reader scope', async () => {
    const foreignContent = `${MARK}-foreign-question-content`;
    const ownContent = `${MARK}-own-question-content`;

    // A question the teacher cannot read: another organization, created by someone else.
    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: FOREIGN_ORG,
        created_by: TEACHER_ID,
        name: `${MARK}-foreign-bank`,
        visibility: 'group',
      })
      .select('id')
      .single();
    expect(bankError).toBeNull();
    foreignBankId = bank!.id;

    const { data: question, error: questionError } = await service
      .from('questions')
      .insert({
        organization_id: FOREIGN_ORG,
        created_by: STUDENT_ID,
        bank_id: foreignBankId,
        type: 'mcq',
        content: foreignContent,
        visibility: 'group',
      })
      .select('id')
      .single();
    expect(questionError).toBeNull();
    foreignQuestionId = question!.id;

    // The positive control: a question of this organization the teacher can read.
    const { data: ownQuestion, error: ownQuestionError } = await service
      .from('questions')
      .insert({
        organization_id: ORG,
        created_by: TEACHER_ID,
        bank_id: BANK,
        type: 'mcq',
        content: ownContent,
        visibility: 'group',
      })
      .select('id')
      .single();
    expect(ownQuestionError).toBeNull();
    positiveQuestionId = ownQuestion!.id;

    // A member of the foreign organization whose name the feed must never reveal.
    const { data: foreignMember, error: foreignMemberError } = await service
      .from('org_members')
      .select('user_id')
      .eq('organization_id', FOREIGN_ORG)
      .limit(1)
      .single();
    expect(foreignMemberError).toBeNull();
    // Precondition of the negative assertion below: that member shares no organization with the
    // teacher, otherwise the guard would (correctly) name them somewhere else in the feed.
    const { data: sharedOrgs } = await service
      .from('org_members')
      .select('organization_id')
      .eq('user_id', foreignMember!.user_id)
      .neq('organization_id', FOREIGN_ORG);
    expect(sharedOrgs).toEqual([]);

    const { data: foreignProfile, error: foreignProfileError } = await service
      .from('profiles')
      .select('full_name, email')
      .eq('id', foreignMember!.user_id)
      .single();
    expect(foreignProfileError).toBeNull();

    const { data: studentProfile, error: studentProfileError } = await service
      .from('profiles')
      .select('full_name, email')
      .eq('id', STUDENT_ID)
      .single();
    expect(studentProfileError).toBeNull();

    const studentName = studentProfile!.full_name?.trim() || studentProfile!.email.split('@')[0];
    const foreignNames = [foreignProfile!.full_name, foreignProfile!.email.split('@')[0]].filter(
      (name): name is string => Boolean(name),
    );

    // A member may report a known question id; the report is legitimate, the excerpt is not.
    const { data: foreignReport, error: foreignReportError } = await student
      .from('question_reports')
      .insert({
        question_id: foreignQuestionId,
        organization_id: ORG,
        reported_by: STUDENT_ID,
        teacher_id: TEACHER_ID,
      })
      .select('id, created_at')
      .single();
    expect(foreignReportError).toBeNull();
    foreignQuestionReportId = foreignReport!.id;

    // The attack: a forged reporter id passes the report policy's org/teacher arm.
    const { data: forgedReport, error: forgedReportError } = await student
      .from('question_reports')
      .insert({
        question_id: foreignQuestionId,
        organization_id: ORG,
        reported_by: foreignMember!.user_id,
        teacher_id: TEACHER_ID,
      })
      .select('id, created_at')
      .single();
    expect(forgedReportError).toBeNull();
    forgedReportId = forgedReport!.id;

    // A group report has no question at all: it still shows, without an excerpt.
    const { data: groupReport, error: groupReportError } = await student
      .from('question_reports')
      .insert({
        group_id: secondGroupId,
        organization_id: ORG,
        reported_by: STUDENT_ID,
        teacher_id: TEACHER_ID,
      })
      .select('id, created_at')
      .single();
    expect(groupReportError).toBeNull();
    groupReportId = groupReport!.id;

    // A readable question reports normally, excerpt and all — an INNER JOIN / `AND false`
    // "fix" would blank this row too.
    const { data: ownReport, error: ownReportError } = await student
      .from('question_reports')
      .insert({
        question_id: positiveQuestionId,
        organization_id: ORG,
        reported_by: STUDENT_ID,
        teacher_id: TEACHER_ID,
      })
      .select('id, created_at')
      .single();
    expect(ownReportError).toBeNull();
    positiveReportId = ownReport!.id;

    const items = await feed();
    const foreignRows = items.filter(
      (item) => item.kind === 'report_opened' && item.questionId === foreignQuestionId,
    );

    // Both reports are still events, but neither carries the unreadable excerpt ...
    expect(foreignRows.length).toBeGreaterThanOrEqual(2);
    expect(foreignRows.every((item) => item.title === null)).toBe(true);
    expect(items.every((item) => !(item.title ?? '').includes(foreignContent))).toBe(true);
    // ... the legitimate reporter keeps their own name ...
    expect(foreignRows.some((item) => item.personName === studentName)).toBe(true);
    // ... and the forged foreign id names nobody.
    for (const name of foreignNames) {
      expect(items.some((item) => item.personName === name)).toBe(false);
    }

    const groupRow = items.find((item) => item.at === groupReport!.created_at);
    expect(groupRow?.kind).toBe('report_opened');
    expect(groupRow?.questionId).toBeNull();

    const ownRow = items.find((item) => item.questionId === positiveQuestionId);
    expect(ownRow?.kind).toBe('report_opened');
    expect(ownRow?.title).toBe(ownContent.slice(0, 120));
    expect(ownRow?.personName).toBe(studentName);
  });

  it('keeps an assignment attempt one after its assignment is deleted', async () => {
    const { data: assignment, error: assignmentError } = await service
      .from('teacher_assignments')
      .insert({ created_by: TEACHER_ID, organization_id: ORG, title: `${MARK}-marker` })
      .select('id')
      .single();
    expect(assignmentError).toBeNull();

    const { data: attempt, error: attemptError } = await service
      .from('quiz_attempts')
      .insert(
        finished(null, { title: `${MARK}-marker-attempt` }, { assignment_id: assignment!.id }),
      )
      .select('id, organization_id, is_assignment_attempt')
      .single();
    expect(attemptError).toBeNull();
    // stamped by the assignment, and marked durable by the #657 trigger
    expect(attempt?.organization_id).toBe(ORG);
    expect(attempt?.is_assignment_attempt).toBe(true);

    const awaitingBefore = (await perf()).totals.awaitingGrade;
    // Before the delete the feed names the attempt after its assignment, not the config title.
    const before = (await feed()).find((item) => item.assignmentId === assignment!.id);
    expect(before?.kind).toBe('assignment_submitted');
    expect(before?.title).toBe(`${MARK}-marker`);
    expect(before?.needsGrading).toBe(true);

    // Deleting the assignment is the legitimate path (`assignment_id` is ON DELETE SET NULL):
    // the durable marker must keep the attempt an assignment without its link.
    const { error: deleteError } = await service
      .from('teacher_assignments')
      .delete()
      .eq('id', assignment!.id);
    expect(deleteError).toBeNull();

    const { data: orphaned, error: orphanError } = await service
      .from('quiz_attempts')
      .select('assignment_id, is_assignment_attempt')
      .eq('id', attempt!.id)
      .single();
    expect(orphanError).toBeNull();
    expect(orphaned?.assignment_id).toBeNull();
    expect(orphaned?.is_assignment_attempt).toBe(true);

    expect((await perf()).totals.awaitingGrade).toBe(awaitingBefore);
    const after = (await feed()).find((item) => item.title === `${MARK}-marker-attempt`);
    expect(after?.kind).toBe('assignment_submitted');
    expect(after?.needsGrading).toBe(true);
  });

  it('an auto-scored assignment counts without waiting for a grade', async () => {
    const before = await perf();

    const { data: assignment, error: assignmentError } = await service
      .from('teacher_assignments')
      .insert({ created_by: TEACHER_ID, organization_id: ORG, title: `${MARK}-auto-asg` })
      .select('id')
      .single();
    expect(assignmentError).toBeNull();

    const { data: attempt, error: attemptError } = await service
      .from('quiz_attempts')
      .insert(
        finished(
          null,
          { title: `${MARK}-autograded` },
          { assignment_id: assignment!.id, score: 1, total_questions: 1 },
        ),
      )
      .select('id, organization_id, is_assignment_attempt')
      .single();
    expect(attemptError).toBeNull();
    expect(attempt?.organization_id).toBe(ORG);
    expect(attempt?.is_assignment_attempt).toBe(true);

    const { error: answerError } = await service.from('student_answers').insert({
      attempt_id: attempt!.id,
      question_type: 'mcq',
      is_correct: true,
    });
    expect(answerError).toBeNull();

    const after = await perf();
    expect(after.totals.completedAttempts - before.totals.completedAttempts).toBe(1);
    expect(after.totals.awaitingGrade - before.totals.awaitingGrade).toBe(0);

    const row = (await feed()).find((item) => item.assignmentId === assignment!.id);
    expect(row?.kind).toBe('assignment_submitted');
    expect(row?.needsGrading).toBe(false);
  });

  it("an open answer waits for the teacher's mark", async () => {
    const before = await perf();

    const { data: assignment, error: assignmentError } = await service
      .from('teacher_assignments')
      .insert({ created_by: TEACHER_ID, organization_id: ORG, title: `${MARK}-open-asg` })
      .select('id')
      .single();
    expect(assignmentError).toBeNull();

    const { data: attempt, error: attemptError } = await service
      .from('quiz_attempts')
      .insert(finished(null, { title: `${MARK}-open-answer` }, { assignment_id: assignment!.id }))
      .select('id')
      .single();
    expect(attemptError).toBeNull();

    const { error: answerError } = await service.from('student_answers').insert({
      attempt_id: attempt!.id,
      question_type: 'open',
      text_answer: 'x',
    });
    expect(answerError).toBeNull();

    const awaiting = await perf();
    expect(awaiting.totals.awaitingGrade - before.totals.awaitingGrade).toBe(1);
    const waiting = (await feed()).find((item) => item.assignmentId === assignment!.id);
    expect(waiting?.kind).toBe('assignment_submitted');
    expect(waiting?.needsGrading).toBe(true);

    const { error: gradeError } = await service
      .from('quiz_attempts')
      .update({ graded_at: new Date().toISOString() })
      .eq('id', attempt!.id);
    expect(gradeError).toBeNull();

    const graded = await perf();
    expect(graded.totals.awaitingGrade - before.totals.awaitingGrade).toBe(0);
    const marked = (await feed()).find((item) => item.assignmentId === assignment!.id);
    expect(marked?.kind).toBe('assignment_submitted');
    expect(marked?.needsGrading).toBe(false);
  });

  it('a mixed assignment with only its MCQ answered still waits for a mark', async () => {
    const before = await perf();

    const { data: mixedAssignment, error: assignmentError } = await service
      .from('teacher_assignments')
      .insert({ created_by: TEACHER_ID, organization_id: ORG, title: `${MARK}-mixed-asg` })
      .select('id')
      .single();
    expect(assignmentError).toBeNull();

    const { data: questions, error: questionsError } = await service
      .from('questions')
      .insert([
        {
          organization_id: ORG,
          created_by: TEACHER_ID,
          bank_id: BANK,
          type: 'open',
          content: `${MARK}-mixed-open`,
          visibility: 'group',
        },
        {
          organization_id: ORG,
          created_by: TEACHER_ID,
          bank_id: BANK,
          type: 'mcq',
          content: `${MARK}-mixed-mcq`,
          visibility: 'group',
        },
      ])
      .select('id, type');
    expect(questionsError).toBeNull();
    mixedQuestionIds = questions!.map((question) => question.id);
    const mcqQuestion = questions!.find((question) => question.type === 'mcq')!;

    const { error: linkError } = await service.from('assignment_questions').insert(
      questions!.map((question) => ({
        assignment_id: mixedAssignment!.id,
        question_id: question.id,
      })),
    );
    expect(linkError).toBeNull();

    const { data: attempt, error: attemptError } = await service
      .from('quiz_attempts')
      .insert(
        finished(null, { title: `${MARK}-mixed-attempt` }, { assignment_id: mixedAssignment!.id }),
      )
      .select('id')
      .single();
    expect(attemptError).toBeNull();

    // Only the MCQ is answered: no `open` answer row exists, but the assignment still asks one.
    const { error: answerError } = await service.from('student_answers').insert({
      attempt_id: attempt!.id,
      question_id: mcqQuestion.id,
      question_type: 'mcq',
      is_correct: true,
    });
    expect(answerError).toBeNull();

    const awaiting = await perf();
    expect(awaiting.totals.awaitingGrade - before.totals.awaitingGrade).toBe(1);
    const row = (await feed()).find((item) => item.assignmentId === mixedAssignment!.id);
    expect(row?.kind).toBe('assignment_submitted');
    expect(row?.needsGrading).toBe(true);
  });

  it('clears the organization stamp when a practice snapshot becomes mixed', async () => {
    const before = await perf();

    const { data: questions, error: questionsError } = await service
      .from('questions')
      .insert([
        {
          organization_id: ORG,
          created_by: TEACHER_ID,
          bank_id: BANK,
          type: 'mcq',
          content: `${MARK}-stamp-org`,
          visibility: 'group',
        },
        {
          organization_id: null,
          created_by: TEACHER_ID,
          bank_id: BANK,
          type: 'mcq',
          content: `${MARK}-stamp-personal`,
          visibility: 'personal',
        },
      ])
      .select('id');
    expect(questionsError).toBeNull();
    stampQuestionIds = questions!.map((question) => question.id);

    const { data: attempt, error: attemptError } = await service
      .from('quiz_attempts')
      .insert({
        user_id: STUDENT_ID,
        score: 0,
        total_questions: 2,
        config: { marker: MARK },
        completed_at: new Date().toISOString(),
      })
      .select('id, organization_id')
      .single();
    expect(attemptError).toBeNull();
    expect(attempt?.organization_id).toBeNull();

    // The first snapshot is one group-visible question of this organization: it stamps the attempt.
    const { error: firstError } = await service.from('quiz_attempt_questions').insert({
      attempt_id: attempt!.id,
      question_id: stampQuestionIds[0],
    });
    expect(firstError).toBeNull();
    const { data: stamped } = await service
      .from('quiz_attempts')
      .select('organization_id')
      .eq('id', attempt!.id)
      .single();
    expect(stamped?.organization_id).toBe(ORG);
    const afterFirst = await perf();
    expect(afterFirst.totals.completedAttempts - before.totals.completedAttempts).toBe(1);

    // A later personal question makes the whole snapshot ineligible: the old stamp must go.
    const { error: secondError } = await service.from('quiz_attempt_questions').insert({
      attempt_id: attempt!.id,
      question_id: stampQuestionIds[1],
    });
    expect(secondError).toBeNull();
    const { data: cleared } = await service
      .from('quiz_attempts')
      .select('organization_id')
      .eq('id', attempt!.id)
      .single();
    expect(cleared?.organization_id).toBeNull();
    const afterMixed = await perf();
    expect(afterMixed.totals.completedAttempts - before.totals.completedAttempts).toBe(0);

    // Removing the personal row makes the snapshot eligible again (DELETE transition table).
    const { error: deletePersonalError } = await service
      .from('quiz_attempt_questions')
      .delete()
      .eq('attempt_id', attempt!.id)
      .eq('question_id', stampQuestionIds[1]);
    expect(deletePersonalError).toBeNull();
    expect(await stampOf(attempt!.id)).toBe(ORG);

    // Pointing the remaining row at the personal question clears it again (UPDATE).
    const { error: toPersonalError } = await service
      .from('quiz_attempt_questions')
      .update({ question_id: stampQuestionIds[1] })
      .eq('attempt_id', attempt!.id)
      .eq('question_id', stampQuestionIds[0]);
    expect(toPersonalError).toBeNull();
    expect(await stampOf(attempt!.id)).toBeNull();

    // Back to the organization's question: eligible again.
    const { error: backError } = await service
      .from('quiz_attempt_questions')
      .update({ question_id: stampQuestionIds[0] })
      .eq('attempt_id', attempt!.id)
      .eq('question_id', stampQuestionIds[1]);
    expect(backError).toBeNull();
    expect(await stampOf(attempt!.id)).toBe(ORG);

    // The last row gone leaves no snapshot at all: the stamp must clear (DELETE).
    const { error: deleteLastError } = await service
      .from('quiz_attempt_questions')
      .delete()
      .eq('attempt_id', attempt!.id);
    expect(deleteLastError).toBeNull();
    expect(await stampOf(attempt!.id)).toBeNull();
  });

  it('a student gets nothing from either dashboard RPC', async () => {
    const { data: groups, error: groupsError } = await student.rpc(
      'get_teacher_group_performance',
      { p_user_id: STUDENT_ID, p_organization_id: ORG },
    );
    expect(groupsError).toBeNull();
    expect(groups).toEqual({
      groups: [],
      totals: { students: 0, completedAttempts: 0, awaitingGrade: 0 },
    });

    const { data: rows, error: feedError } = await student.rpc('get_teacher_activity_feed', {
      p_user_id: STUDENT_ID,
      p_organization_id: ORG,
    });
    expect(feedError).toBeNull();
    expect(rows).toEqual([]);
  });

  it('restamps an attempt when its assignment changes and keeps the stamp when the link clears', async () => {
    const { data: attempt, error: attemptError } = await service
      .from('quiz_attempts')
      .insert(
        finished(ORG, { title: `${MARK}-restamp-attempt` }, { assignment_id: ownAssignmentId }),
      )
      .select('id, organization_id')
      .single();
    expect(attemptError).toBeNull();
    expect(attempt?.organization_id).toBe(ORG);

    const { data: moved, error: moveError } = await student
      .from('quiz_attempts')
      .update({ assignment_id: foreignAssignmentId })
      .eq('id', attempt!.id)
      .select('organization_id')
      .single();
    expect(moveError).toBeNull();
    expect(moved?.organization_id).toBe(FOREIGN_ORG);

    // ON DELETE SET NULL semantics, reached here by clearing the link directly.
    const { data: cleared, error: clearError } = await student
      .from('quiz_attempts')
      .update({ assignment_id: null })
      .eq('id', attempt!.id)
      .select('organization_id')
      .single();
    expect(clearError).toBeNull();
    expect(cleared?.organization_id).toBe(FOREIGN_ORG);
  });

  it('restamps a review when its card changes and clears it for a personal card', async () => {
    const { data: practice, error: practiceError } = await service
      .from('flashcard_practice')
      .insert({ user_id: STUDENT_ID, flashcard_id: groupCardId, was_correct: true })
      .select('id, organization_id')
      .single();
    expect(practiceError).toBeNull();
    expect(practice?.organization_id).toBe(ORG);
    restampPracticeIds.push(practice!.id);

    const { data: personalDeck, error: personalDeckError } = await service
      .from('flashcard_decks')
      .insert({ created_by: STUDENT_ID, name: `${MARK}-personal-deck`, visibility: 'personal' })
      .select('id')
      .single();
    expect(personalDeckError).toBeNull();
    restampDeckIds.push(personalDeck!.id);

    const { data: personalCard, error: personalCardError } = await service
      .from('flashcards')
      .insert({
        deck_id: personalDeck!.id,
        created_by: STUDENT_ID,
        front: `${MARK}-personal-front`,
        back: `${MARK}-personal-back`,
        visibility: 'personal',
      })
      .select('id')
      .single();
    expect(personalCardError).toBeNull();
    restampCardIds.push(personalCard!.id);

    const { data: personal, error: personalError } = await student
      .from('flashcard_practice')
      .update({ flashcard_id: personalCard!.id })
      .eq('id', practice!.id)
      .select('organization_id')
      .single();
    expect(personalError).toBeNull();
    expect(personal?.organization_id).toBeNull();

    const { data: foreignDeck, error: foreignDeckError } = await service
      .from('flashcard_decks')
      .insert({
        organization_id: FOREIGN_ORG,
        created_by: TEACHER_ID,
        name: `${MARK}-foreign-deck`,
        visibility: 'group',
      })
      .select('id')
      .single();
    expect(foreignDeckError).toBeNull();
    restampDeckIds.push(foreignDeck!.id);

    const { data: foreignCard, error: foreignCardError } = await service
      .from('flashcards')
      .insert({
        deck_id: foreignDeck!.id,
        organization_id: FOREIGN_ORG,
        created_by: TEACHER_ID,
        front: `${MARK}-foreign-front`,
        back: `${MARK}-foreign-back`,
        visibility: 'group',
      })
      .select('id')
      .single();
    expect(foreignCardError).toBeNull();
    restampCardIds.push(foreignCard!.id);

    const { data: foreign, error: foreignError } = await student
      .from('flashcard_practice')
      .update({ flashcard_id: foreignCard!.id })
      .eq('id', practice!.id)
      .select('organization_id')
      .single();
    expect(foreignError).toBeNull();
    expect(foreign?.organization_id).toBe(FOREIGN_ORG);
  });

  it("does not read a foreign assignment's open questions when judging a grade", async () => {
    const before = await perf();

    const { data: openQuestion, error: questionError } = await service
      .from('questions')
      .insert({
        organization_id: FOREIGN_ORG,
        created_by: TEACHER_ID,
        bank_id: BANK,
        type: 'open',
        content: `${MARK}-scope-open`,
        visibility: 'group',
      })
      .select('id')
      .single();
    expect(questionError).toBeNull();
    scopeQuestionIds.push(openQuestion!.id);

    const { error: linkError } = await service.from('assignment_questions').insert({
      assignment_id: foreignAssignmentId,
      question_id: openQuestion!.id,
    });
    expect(linkError).toBeNull();

    const { data: attempt, error: attemptError } = await service
      .from('quiz_attempts')
      .insert(
        finished(null, { title: `${MARK}-scope-attempt` }, { assignment_id: foreignAssignmentId }),
      )
      .select('id')
      .single();
    expect(attemptError).toBeNull();

    // A non-open answer disables the "nothing answered" arm, so only the assignment-question
    // lookup could mark this as waiting.
    const { error: answerError } = await service.from('student_answers').insert({
      attempt_id: attempt!.id,
      question_type: 'mcq',
      is_correct: false,
    });
    expect(answerError).toBeNull();

    // Only a privileged write can pair an ORG stamp with a foreign assignment; the lookup must
    // still stay inside p_organization_id.
    await service.from('quiz_attempts').update({ organization_id: ORG }).eq('id', attempt!.id);
    expect(await stampOf(attempt!.id)).toBe(ORG);

    const after = await perf();
    expect(after.totals.completedAttempts - before.totals.completedAttempts).toBe(1);
    expect(after.totals.awaitingGrade - before.totals.awaitingGrade).toBe(0);

    const row = (await feed()).find((item) => item.title === `${MARK}-scope-attempt`);
    expect(row?.kind).toBe('assignment_submitted');
    expect(row?.needsGrading).toBe(false);
  });
});
