import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@studiq/server/types/database';
import * as supabaseModule from '@studiq/server/lib/supabase/server';
import { type BeforeResult, before } from '#test/helpers/test-user';
import { asJson, json } from '#test/helpers/json';
import {
  cleanupOrganizationDeep,
  cleanupQuestions,
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
import { GET as questionsList } from '@/app/(backend)/api/v1/questions/route';
import { GET as questionGet } from '@/app/(backend)/api/v1/questions/[id]/route';
import { GET as banksList } from '@/app/(backend)/api/v1/questions/banks/route';
import { GET as bankGet } from '@/app/(backend)/api/v1/questions/banks/[id]/route';
import { POST as quizNew } from '@/app/(backend)/api/v1/quiz/new/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1171 slice 2: an item bound to an assessment whose window is open is absent — not locked —
// for the students that assessment targets, and stays available to every other class. The seam is
// the real service stack against local Supabase, so the seal is derived from `ctx` exactly as the
// running server derives it.

interface QuestionItem {
  id: string;
  content: string;
  explanation?: string;
  question_answers?: Array<{ id: string; content: string; is_correct?: boolean }>;
}

interface QuestionListPayload {
  items: QuestionItem[];
  total: number;
}

interface BankPayload {
  id: string;
  question_count: number;
  heldCount?: number;
  heldUntil?: string | null;
}

interface PracticePayload {
  questions: QuestionItem[];
}

/** The next request runs as this user. */
function as(user: BeforeResult['user']): void {
  mockUser(user);
}

const SEEDED_PASSWORD = 'Seed4Test!';

/**
 * The next request runs as a **real** session: the client below carries the user's JWT, so
 * PostgREST applies RLS exactly as it does for a signed-in browser. `as()` swaps in the
 * service-role client, which hides an RLS-dependent regression (slice 2a review, finding 2).
 */
async function asRealSession(user: BeforeResult['user']): Promise<void> {
  const session = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await session.auth.signInWithPassword({
    email: user.email,
    password: SEEDED_PASSWORD,
  });
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`);
  vi.mocked(supabaseModule.createClient).mockResolvedValue(session);
}

function FUTURE(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString();
}

function PAST(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

describe('Sealed items are absent from student reads (#1171)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let studentA!: BeforeResult;
  let studentB!: BeforeResult;
  let orgId!: string;
  let groupA!: string;
  let groupB!: string;
  let bankId!: string;
  let sealedId!: string;
  let openId!: string;
  let assignmentId!: string;
  let deadline!: string;

  function cookie(): Record<string, string> {
    return { active_org_id: orgId };
  }

  async function listBank(): Promise<QuestionListPayload> {
    const request = createNextRequest(
      `http://localhost/api/v1/questions?bankId=${bankId}&page=1&limit=25`,
      {},
      cookie(),
    );
    const response = await questionsList(request);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: QuestionListPayload }>(response)).data;
  }

  async function bankDetail(): Promise<BankPayload> {
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/banks/${bankId}`,
      { id: bankId },
      {},
      cookie(),
    );
    const response = await bankGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: BankPayload }>(response)).data;
  }

  async function practice(): Promise<PracticePayload> {
    const request = createNextRequest(
      'http://localhost/api/v1/quiz/new',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankId, questionTypes: ['mcq'], questionCount: 10 }),
      },
      cookie(),
    );
    const response = await quizNew(request);
    expect(response.status, await response.clone().text()).toBe(201);
    return (await json<{ data: PracticePayload }>(response)).data;
  }

  async function question(id: string): Promise<number> {
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${id}`,
      { id },
      {},
      cookie(),
    );
    return (await questionGet(request, { params })).status;
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 2 });
    studentA = await before({ role: 'student' });
    studentB = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    groupA = requiredAt(teacher.groups, 0, 'the seeded extra group');

    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    const memberRoleId = asJson<{ id: string }>(memberRole).id;

    const { data: group, error: groupError } = await service
      .from('groups')
      .insert({ organization_id: orgId, name: `seal-class-b-${Date.now()}` })
      .select('id')
      .single();
    if (groupError) throw new Error(`group: ${groupError.message}`);
    groupB = group.id;

    for (const [student, memberGroup] of [
      [studentA, groupA],
      [studentB, groupB],
    ] as const) {
      await seedOrgMembership({
        organizationId: orgId,
        userId: student.user.id,
        orgRoleId: memberRoleId,
      });
      await seedGroupMembership({ groupId: memberGroup, userId: student.user.id, role: 'member' });
    }

    sealedId = requiredAt(teacher.created.questions, 0, 'the seeded question');
    openId = requiredAt(teacher.created.questions, 1, 'the seeded question');
    await service
      .from('questions')
      .update({ explanation: `sealed-explanation-${Date.now()}` })
      .eq('id', sealedId);
    const { data: bankRow } = await service
      .from('questions')
      .select('bank_id')
      .eq('id', sealedId)
      .single();
    bankId = asJson<{ bank_id: string }>(bankRow).bank_id;

    // Both classes read the bank: the seal is what withholds the item from 8A, not the share.
    await service.from('bank_groups').insert([
      { bank_id: bankId, group_id: groupA },
      { bank_id: bankId, group_id: groupB },
    ]);

    deadline = FUTURE();
    as(teacher.user);
    const createRequest = createNextRequest(
      'http://localhost/api/v1/teacher/assignments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `seal-${Date.now()}`, deadline }),
      },
      cookie(),
    );
    const createdResponse = await createAssignmentPost(createRequest);
    expect(createdResponse.status, await createdResponse.clone().text()).toBe(201);
    assignmentId = (await json<{ data: { id: string } }>(createdResponse)).data.id;

    const addQuestion = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: [sealedId] }),
      },
      cookie(),
    );
    expect(
      (await addQuestionsPost(addQuestion.request, { params: addQuestion.params })).status,
    ).toBe(200);

    const targets = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/targets`,
      { id: assignmentId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds: [groupA] }),
      },
      cookie(),
    );
    expect((await targetsPut(targets.request, { params: targets.params })).status).toBe(200);
    // The author is targeted too, so "staff reads unchanged" is a real claim: a seal computed for
    // staff would drop the item from the teacher's own list.
    await service
      .from('assignment_targets')
      .insert({ assignment_id: assignmentId, student_id: teacher.user.id });

    const publish = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 8B can still practise the bank, so the run is published as an acknowledged exposure.
        body: JSON.stringify({ acknowledgeExposure: true }),
      },
      cookie(),
    );
    const published = await publishPost(publish.request, { params: publish.params });
    expect(published.status, await published.clone().text()).toBe(200);
  });

  afterAll(async () => {
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('hides a sealed item from the targeted student bank list, get and practice', async () => {
    as(studentA.user);
    const list = await listBank();
    expect(list.items.map((item) => item.id)).toEqual([openId]);
    expect(list.total, 'the pager total excludes the held item too').toBe(1);

    expect(await question(sealedId), 'a sealed item is 404, like a nonexistent one').toBe(404);
    expect(await question(openId), 'the unheld sibling stays readable').toBe(200);

    const practicePayload = await practice();
    expect(practicePayload.questions.map((item) => item.id)).toEqual([openId]);
  });

  it('answers the sealed item 404 with the same body as a nonexistent item', async () => {
    as(studentA.user);
    const sealed = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${sealedId}`,
      { id: sealedId },
      {},
      cookie(),
    );
    const missingId = crypto.randomUUID();
    const missing = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${missingId}`,
      { id: missingId },
      {},
      cookie(),
    );
    const sealedResponse = await questionGet(sealed.request, { params: sealed.params });
    const missingResponse = await questionGet(missing.request, { params: missing.params });
    expect(sealedResponse.status).toBe(404);
    expect(missingResponse.status).toBe(404);
    expect(await sealedResponse.text()).toBe(await missingResponse.text());
    expect(sealedResponse.headers.get('x-error-code')).toBe(
      missingResponse.headers.get('x-error-code'),
    );
  });

  it('reports the held count and the latest close instead of the items (R14)', async () => {
    // A real session: the count and the list must agree under RLS. A service-role mock would count
    // the held rows and let a double subtraction pass (slice 2a review, findings 1–2).
    await asRealSession(studentA.user);
    const bank = await bankDetail();
    expect(bank.heldCount).toBe(1);
    expect(new Date(bank.heldUntil ?? '').toISOString()).toBe(deadline);
    expect(bank.question_count, 'the count a student sees is the openable one').toBe(1);

    const request = createNextRequest(
      'http://localhost/api/v1/questions/banks?limit=100',
      {},
      cookie(),
    );
    const response = await banksList(request);
    expect(response.status).toBe(200);
    const page = (await json<{ data: { items: BankPayload[] } }>(response)).data;
    expect(page.items.find((item) => item.id === bankId)?.question_count).toBe(1);
  });

  it('keeps the item available to a class outside the window', async () => {
    as(studentB.user);
    const list = await listBank();
    expect(list.items.map((item) => item.id).toSorted()).toEqual([openId, sealedId].toSorted());
    expect(list.total).toBe(2);
    expect(await question(sealedId), '8B practises freely (R2)').toBe(200);

    const practicePayload = await practice();
    expect(practicePayload.questions.map((item) => item.id)).toContain(sealedId);

    const bank = await bankDetail();
    expect(bank.heldCount).toBe(0);
    expect(bank.heldUntil).toBeNull();
    expect(bank.question_count).toBe(2);
  });

  it('does not seal before the window opens', async () => {
    await service
      .from('teacher_assignments')
      .update({ start_time: FUTURE(), deadline: FUTURE() })
      .eq('id', assignmentId);

    as(studentA.user);
    const list = await listBank();
    expect(list.items.map((item) => item.id).toSorted()).toEqual([openId, sealedId].toSorted());
    expect((await bankDetail()).heldCount).toBe(0);

    await service
      .from('teacher_assignments')
      .update({ start_time: null, deadline })
      .eq('id', assignmentId);
  });

  it('releases the item once the window has closed', async () => {
    await service.from('teacher_assignments').update({ deadline: PAST() }).eq('id', assignmentId);

    as(studentA.user);
    const list = await listBank();
    expect(list.items.map((item) => item.id).toSorted()).toEqual([openId, sealedId].toSorted());
    expect(await question(sealedId)).toBe(200);
    expect((await bankDetail()).heldCount).toBe(0);
  });

  it('leaves staff reads untouched, key included', async () => {
    as(teacher.user);
    const list = await listBank();
    expect(list.items.map((item) => item.id).toSorted()).toEqual([openId, sealedId].toSorted());
    const sealed = list.items.find((item) => item.id === sealedId);
    expect(sealed?.explanation, 'the author keeps the key').toBeTruthy();
    expect(sealed?.question_answers?.some((option) => option.is_correct === true)).toBe(true);
  });
});
