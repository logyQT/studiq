import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@studiq/server/types/database';
import { type BeforeResult, before } from '#test/helpers/test-user';
import { asJson, json } from '#test/helpers/json';
import {
  cleanupOrganizationDeep,
  cleanupQuestions,
  cleanupQuizAttempts,
  cleanupTeacherAssignments,
  createServiceClient,
  mockUser,
  seedGroupMembership,
  seedOrgMembership,
} from '#test/integration/helpers';
import {
  createNextRequest,
  createNextRequestWithParams,
  requiredAt,
} from '#test/integration/test-utils';
import { GET as reviewGet } from '@/app/(backend)/api/v1/assignments/[id]/review/route';
import { POST as questionPost } from '@/app/(backend)/api/v1/questions/route';
import { POST as practicePost } from '@/app/(backend)/api/v1/quiz/new/route';
import {
  GET as attemptGet,
  POST as attemptSubmit,
} from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { GET as assignmentGet } from '@/app/(backend)/api/v1/assignments/[id]/route';
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';
import { POST as releasePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/[questionId]/release/route';

// #1171 slice 3c: the exposure ledger (R8 / decision g). A review render is what burns an item for
// the student who saw its key; the write is idempotent per (student, item) and is reachable only by
// the server. The row policy is exercised with real user JWTs against PostgREST.

const SEEDED_PASSWORD = 'Seed4Test!';

interface ReviewPayload {
  items: Array<{ itemId: string }>;
}

interface PracticePayload {
  id: string;
  questions: Array<{ id: string; question_answers?: Array<{ id: string }> }>;
}

function as(user: BeforeResult['user']): void {
  mockUser(user);
}

function FUTURE(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString();
}

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: SEEDED_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

describe('Exposure ledger (#1171)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let idle!: BeforeResult;
  let orgId!: string;
  let groupId!: string;
  let bankId!: string;
  let firstId!: string;
  let secondId!: string;
  let practiceId!: string;
  let assignmentId!: string;

  const cookie = () => ({ active_org_id: orgId });

  async function events(
    studentId: string,
    questionId?: string,
  ): Promise<Array<{ question_id: string; organization_id: string | null; group_ids: string[] }>> {
    let query = service
      .from('exposure_events')
      .select('question_id, organization_id, group_ids, seen_correct')
      .eq('student_id', studentId);
    if (questionId) query = query.eq('question_id', questionId);
    const { data, error } = await query;
    if (error) throw new Error(`exposure_events: ${error.message}`);
    return asJson<typeof data>(data);
  }

  async function review(
    user: BeforeResult['user'],
    attemptId?: string,
  ): Promise<{ status: number; error?: string; data?: ReviewPayload }> {
    as(user);
    const suffix = attemptId ? `?attemptId=${attemptId}` : '';
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/review${suffix}`,
      { id: assignmentId },
      {},
      cookie(),
    );
    const response = await reviewGet(request, { params });
    const body = await json<{ data?: ReviewPayload; error?: string }>(response);
    return { status: response.status, ...body };
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 2 });
    student = await before({ role: 'student' });
    idle = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    groupId = requiredAt(teacher.groups, 0, 'the seeded group');

    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    for (const member of [student, idle]) {
      await seedOrgMembership({
        organizationId: orgId,
        userId: member.user.id,
        orgRoleId: asJson<{ id: string }>(memberRole).id,
      });
      await seedGroupMembership({ groupId, userId: member.user.id, role: 'member' });
    }

    firstId = requiredAt(teacher.created.questions, 0, 'first item');
    secondId = requiredAt(teacher.created.questions, 1, 'second item');
    const { data: questionRow } = await service
      .from('questions')
      .select('bank_id')
      .eq('id', firstId)
      .single();
    bankId = asJson<{ bank_id: string }>(questionRow).bank_id;
    await service.from('bank_groups').insert({ bank_id: bankId, group_id: groupId });

    // A third item that no assessment binds, so the practice case has an item no review has burnt.
    as(teacher.user);
    const practiceItem = createNextRequest(
      'http://localhost/api/v1/questions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankId,
          type: 'mcq',
          content: `ledger-practice-${Date.now()}`,
          answers: [
            { content: 'right', isCorrect: true, orderIndex: 0 },
            { content: 'wrong', isCorrect: false, orderIndex: 1 },
          ],
        }),
      },
      cookie(),
    );
    const practiceResponse = await questionPost(practiceItem);
    expect(practiceResponse.status, await practiceResponse.clone().text()).toBe(201);
    practiceId = (await json<{ data: { id: string } }>(practiceResponse)).data.id;

    as(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `ledger-${Date.now()}`,
            deadline: FUTURE(),
            showResults: true,
          }),
        },
        cookie(),
      ),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    assignmentId = (await json<{ data: { id: string } }>(created)).data.id;

    const add = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: [firstId, secondId] }),
      },
      cookie(),
    );
    expect((await addQuestionsPost(add.request, { params: add.params })).status).toBe(200);

    const targets = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/targets`,
      { id: assignmentId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds: [groupId] }),
      },
      cookie(),
    );
    expect((await targetsPut(targets.request, { params: targets.params })).status).toBe(200);

    const publish = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: FUTURE() }),
      },
      cookie(),
    );
    expect((await publishPost(publish.request, { params: publish.params })).status).toBe(200);

    // The student submits, so the review has an attempt to show.
    as(student.user);
    const started = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    const attempt = await assignmentStart(started.request, { params: started.params });
    expect(attempt.status, await attempt.clone().text()).toBe(200);
    const attemptBody = (await json<{ data: PracticePayload }>(attempt)).data;

    const submit = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attemptBody.id}`,
      { attemptId: attemptBody.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attemptBody.id, answers: [] }),
      },
      cookie(),
    );
    expect((await attemptSubmit(submit.request, { params: submit.params })).status).toBe(200);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupQuizAttempts(idle.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('records nothing while the review is locked (nothing rendered)', async () => {
    const locked = await review(student.user);
    expect(locked.status).toBe(403);
    expect(locked.error).toBe('REVIEW_LOCKED');
    expect(await events(student.user.id)).toEqual([]);
  });

  it('records nothing when the teacher never enabled results', async () => {
    await service
      .from('teacher_assignments')
      .update({ show_results: false })
      .eq('id', assignmentId);
    const hidden = await review(student.user);
    expect(hidden.status).toBe(404);
    expect(await events(student.user.id)).toEqual([]);
    await service.from('teacher_assignments').update({ show_results: true }).eq('id', assignmentId);
  });

  it('records one event per rendered item at the cohort reveal', async () => {
    as(teacher.user);
    const closeCall = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/close`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    const closed = await closePost(closeCall.request, { params: closeCall.params });
    expect(closed.status, await closed.clone().text()).toBe(200);

    const revealed = await review(student.user);
    expect(revealed.status).toBe(200);
    expect(revealed.data?.items).toHaveLength(2);

    const recorded = await events(student.user.id);
    expect(recorded.map((event) => event.question_id).toSorted()).toEqual(
      [firstId, secondId].toSorted(),
    );
    for (const event of recorded) {
      expect(event.organization_id).toBe(orgId);
      expect(event.group_ids).toEqual([groupId]);
    }
  });

  it('does not duplicate an event on a repeat render (R8)', async () => {
    const again = await review(student.user);
    expect(again.status).toBe(200);
    expect(await events(student.user.id)).toHaveLength(2);
  });

  it('records nothing for a staff preview of the cohort review', async () => {
    // The author can read the cohort artefact (the targeting rule allows the author); that read
    // renders the key to a teacher, not to a learner, so it is not an exposure event.
    as(teacher.user);
    const preview = await review(teacher.user);
    expect(preview.status).toBe(200);
    expect(await events(teacher.user.id)).toEqual([]);
  });

  it('does not burn an item the review holds back, and burns it once released (R10)', async () => {
    // Hold the second item back, release it, and check the ledger follows what was rendered.
    await service
      .from('assignment_questions')
      .update({ withhold_from_review: true })
      .eq('assignment_id', assignmentId)
      .eq('question_id', secondId);
    await service.from('exposure_events').delete().eq('student_id', idle.user.id);
    // A fresh student has no event yet: the review of a held item must not create one.
    as(idle.user);
    const detail = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}`,
      { id: assignmentId },
      {},
      cookie(),
    );
    await assignmentGet(detail.request, { params: detail.params });

    const heldReview = await review(idle.user);
    expect(heldReview.status).toBe(200);
    expect(heldReview.data?.items.map((item) => item.itemId)).toEqual([firstId]);
    expect((await events(idle.user.id)).map((event) => event.question_id)).toEqual([firstId]);

    as(teacher.user);
    const releaseCall = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions/${secondId}/release`,
      { id: assignmentId, questionId: secondId },
      { method: 'POST' },
      cookie(),
    );
    expect((await releasePost(releaseCall.request, { params: releaseCall.params })).status).toBe(
      200,
    );

    const releasedReview = await review(idle.user);
    expect(releasedReview.data?.items.map((item) => item.itemId).toSorted()).toEqual(
      [firstId, secondId].toSorted(),
    );
    expect((await events(idle.user.id)).map((event) => event.question_id).toSorted()).toEqual(
      [firstId, secondId].toSorted(),
    );
  });

  it('records a practice quiz review under the item organisation (R8)', async () => {
    as(student.user);
    const practice = createNextRequest(
      'http://localhost/api/v1/quiz/new',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankId, questionTypes: ['mcq'], questionCount: 25 }),
      },
      cookie(),
    );
    const started = await practicePost(practice);
    expect(started.status, await started.clone().text()).toBe(201);
    const attempt = (await json<{ data: PracticePayload }>(started)).data;
    const question = attempt.questions.find((row) => row.id === practiceId);
    if (!question) throw new Error('the practice quiz did not draw the unbound item');

    const submit = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId: attempt.id,
          answers: [
            {
              questionId: question.id,
              selectedAnswerId: question.question_answers?.[0]?.id ?? '',
            },
          ],
        }),
      },
      cookie(),
    );
    expect((await attemptSubmit(submit.request, { params: submit.params })).status).toBe(200);

    const reviewCall = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {},
      cookie(),
    );
    expect((await attemptGet(reviewCall.request, { params: reviewCall.params })).status).toBe(200);

    const recorded = await events(student.user.id, practiceId);
    expect(recorded, 'a practice key render is an exposure too').toHaveLength(1);
    expect(recorded[0]?.organization_id).toBe(orgId);
    expect(recorded[0]?.group_ids, 'practice belongs to no assessment cohort').toEqual([]);
  });

  it('lets the student read their own ledger and the staff read their org, and nobody else', async () => {
    const own = await signIn(student.user.email);
    const { data: ownRows, error: ownError } = await own
      .from('exposure_events')
      .select('question_id, student_id');
    expect(ownError?.message).toBeUndefined();
    expect((ownRows ?? []).length).toBeGreaterThan(0);
    expect(new Set((ownRows ?? []).map((row) => row.student_id))).toEqual(
      new Set([student.user.id]),
    );

    const other = await signIn(idle.user.email);
    const { data: otherRows } = await other.from('exposure_events').select('student_id');
    expect(
      (otherRows ?? []).every((row) => row.student_id === idle.user.id),
      'a student never sees another student’s ledger',
    ).toBe(true);

    const staff = await signIn(teacher.user.email);
    const { data: staffRows, error: staffError } = await staff
      .from('exposure_events')
      .select('student_id, organization_id');
    expect(staffError?.message).toBeUndefined();
    expect((staffRows ?? []).length, 'staff read the org ledger').toBeGreaterThanOrEqual(2);
    expect((staffRows ?? []).every((row) => row.organization_id === orgId)).toBe(true);
  });

  it('refuses a client-supplied exposure insert (writes are server-only)', async () => {
    const own = await signIn(student.user.email);
    const { error } = await own.from('exposure_events').insert({
      student_id: idle.user.id,
      question_id: firstId,
      seen_correct: true,
    });
    expect(error, 'a student cannot burn another student’s items').not.toBeNull();
    expect(['42501', 'PGRST301']).toContain(error?.code);
  });
});
