import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { GET as questionGet } from '@/app/(backend)/api/v1/questions/[id]/route';
import { GET as bankGet } from '@/app/(backend)/api/v1/questions/banks/[id]/route';
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';
import { PUT as withholdPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/[questionId]/flags/route';
import { POST as releasePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/[questionId]/release/route';

// #1171 slice 3b: withheld items (R10). `withholdFromReview` outranks the automatic release at the
// close: the item stays absent from the review **and** sealed for the class until the teacher
// releases it. The seam is the real route → controller → service stack against local Supabase.

interface ReviewPayload {
  items: Array<{ itemId: string }>;
}

interface BankPayload {
  heldCount?: number;
  heldUntil?: string | null;
  question_count: number;
}

function as(user: BeforeResult['user']): void {
  mockUser(user);
}

function FUTURE(): string {
  return new Date(Date.now() + 2 * 86_400_000).toISOString();
}

async function errorOf(response: Response): Promise<string> {
  const body = await json<{ error?: string }>(response);
  return body.error ?? '';
}

describe('Withheld items stay sealed past the close until released (#1171)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let foreign!: BeforeResult;
  let student!: BeforeResult;
  let orgId!: string;
  let groupId!: string;
  let bankId!: string;
  let heldId!: string;
  let openId!: string;
  let assignmentId!: string;

  const cookie = () => ({ active_org_id: orgId });

  async function withhold(
    questionId: string,
    withheld: boolean,
    user: BeforeResult = teacher,
  ): Promise<Response> {
    as(user.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions/${questionId}/flags`,
      { id: assignmentId, questionId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withheld }),
      },
      { active_org_id: user.orgId ?? orgId },
    );
    return withholdPut(request, { params });
  }

  async function release(questionId: string): Promise<Response> {
    as(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions/${questionId}/release`,
      { id: assignmentId, questionId },
      { method: 'POST' },
      cookie(),
    );
    return releasePost(request, { params });
  }

  async function reviewItemIds(): Promise<string[]> {
    as(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/review`,
      { id: assignmentId },
      {},
      cookie(),
    );
    const response = await reviewGet(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await json<{ data: ReviewPayload }>(response)).data.items.map((item) => item.itemId);
  }

  async function studentQuestion(questionId: string): Promise<number> {
    as(student.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${questionId}`,
      { id: questionId },
      {},
      cookie(),
    );
    return (await questionGet(request, { params })).status;
  }

  async function bankNotice(): Promise<BankPayload> {
    as(student.user);
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

  async function close(): Promise<void> {
    as(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/close`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    const response = await closePost(request, { params });
    expect(response.status, await response.clone().text()).toBe(200);
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 2 });
    foreign = await before({ role: 'educator', org: true, groups: 1, questions: 1 });
    student = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    groupId = requiredAt(teacher.groups, 0, 'the seeded group');

    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    await seedOrgMembership({
      organizationId: orgId,
      userId: student.user.id,
      orgRoleId: asJson<{ id: string }>(memberRole).id,
    });
    await seedGroupMembership({ groupId, userId: student.user.id, role: 'member' });

    [heldId, openId] = [
      requiredAt(teacher.created.questions, 0, 'first item'),
      requiredAt(teacher.created.questions, 1, 'second item'),
    ];
    const { data: questionRow } = await service
      .from('questions')
      .select('bank_id')
      .eq('id', heldId)
      .single();
    bankId = asJson<{ bank_id: string }>(questionRow).bank_id;
    await service.from('bank_groups').insert({ bank_id: bankId, group_id: groupId });

    as(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `withhold-${Date.now()}`,
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
        body: JSON.stringify({ questionIds: [heldId, openId] }),
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
    const published = await publishPost(publish.request, { params: publish.params });
    expect(published.status, await published.clone().text()).toBe(200);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
    if (foreign.orgId) await cleanupOrganizationDeep(foreign.orgId);
  });

  it('holds one item back while the window is live', async () => {
    const response = await withhold(heldId, true);
    expect(response.status, await response.clone().text()).toBe(200);

    const { data: row } = await service
      .from('assignment_questions')
      .select('withhold_from_review, released_at')
      .eq('assignment_id', assignmentId)
      .eq('question_id', heldId)
      .single();
    expect(asJson<{ withhold_from_review: boolean }>(row).withhold_from_review).toBe(true);
  });

  it('refuses the hold to a teacher who does not own the run', async () => {
    const response = await withhold(openId, true, foreign);
    expect(response.status).toBe(404);
  });

  it('clears the hold again before the close', async () => {
    // The flag is a live decision: holding and un-holding before the reveal are both allowed.
    expect((await withhold(heldId, false)).status).toBe(200);
    expect((await withhold(heldId, true)).status).toBe(200);
  });

  it('keeps the withheld item sealed and absent from the review after the close (R10)', async () => {
    await close();

    expect(await reviewItemIds(), 'the review leaves the held item out').toEqual([openId]);
    expect(await studentQuestion(heldId), 'the held item is still sealed').toBe(404);
    expect(await studentQuestion(openId), 'the released sibling is readable again').toBe(200);

    // R14: a held item past its close reads "until released" — no date that has already passed.
    const notice = await bankNotice();
    expect(notice.heldCount).toBe(1);
    expect(notice.heldUntil).toBeNull();
  });

  it('refuses holding an item back after the close (R20)', async () => {
    const response = await withhold(openId, true);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('ASSESSMENT_CLOSED');
  });

  it('refuses releasing an item that was never held back (R19)', async () => {
    const response = await release(openId);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('RELEASE_NOT_WITHHELD');
  });

  it('releases the item: visible in the review and practiceable again (R10)', async () => {
    const response = await release(heldId);
    expect(response.status, await response.clone().text()).toBe(200);

    expect((await reviewItemIds()).toSorted()).toEqual([heldId, openId].toSorted());
    expect(await studentQuestion(heldId)).toBe(200);
    expect((await bankNotice()).heldCount).toBe(0);
  });

  it('refuses a second release of the same item (R19)', async () => {
    const response = await release(heldId);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('RELEASE_NOT_WITHHELD');
  });
});
