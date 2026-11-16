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
import { POST as assignmentStart } from '@/app/(backend)/api/v1/assignments/[id]/start/route';
import { GET as ledgerGet } from '@/app/(backend)/api/v1/questions/[id]/ledger/route';
import { POST as attemptSubmit } from '@/app/(backend)/api/v1/quiz/[attemptId]/route';
import { POST as closePost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/close/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { GET as assignmentGet } from '@/app/(backend)/api/v1/teacher/assignments/[id]/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';

// #1172 phase 3: what a teacher knows about exposure before publishing (R8) — the per-class
// pre-exposure count on the draft, and the staff ledger that names the events behind it. Counts
// only; the ledger names students and never carries a key.

interface AttemptPayload {
  id: string;
  questions: Array<{ id: string; question_answers?: Array<{ id: string }> }>;
}

function FUTURE(): string {
  return new Date(Date.now() + 48 * 3_600_000).toISOString();
}

describe('Exposure before publish (#1172)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  /** An educator of the same organisation who does not author the item: no key permission. */
  let colleague!: BeforeResult;
  let student!: BeforeResult;
  /** The rest of the class: the group target's membership, so its counts are class counts. */
  let cohort: BeforeResult[] = [];
  let orgId!: string;
  let groupId!: string;
  let pool: string[] = [];

  const cookie = () => ({ active_org_id: orgId });

  async function createAssessment(
    title: string,
    questionIds: string[],
    options: { unseenOnly?: boolean } = {},
  ): Promise<string> {
    mockUser(teacher.user);
    const created = await createAssignmentPost(
      createNextRequest(
        'http://localhost/api/v1/teacher/assignments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            deadline: FUTURE(),
            showResults: true,
            shuffleQuestions: false,
            ...options,
          }),
        },
        cookie(),
      ),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const id = (await json<{ data: { id: string } }>(created)).data.id;

    const add = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${id}/questions`,
      { id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds }),
      },
      cookie(),
    );
    expect((await addQuestionsPost(add.request, { params: add.params })).status).toBe(200);

    const targets = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${id}/targets`,
      { id },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds: [groupId] }),
      },
      cookie(),
    );
    expect((await targetsPut(targets.request, { params: targets.params })).status).toBe(200);
    return id;
  }

  async function detailOf(assignmentId: string): Promise<Response> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}`,
      { id: assignmentId },
      {},
      cookie(),
    );
    return assignmentGet(request, { params });
  }

  async function publish(assignmentId: string): Promise<Response> {
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
      { id: assignmentId },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: FUTURE() }),
      },
      cookie(),
    );
    return publishPost(request, { params });
  }

  async function sit(user: BeforeResult['user'], assignmentId: string): Promise<string[]> {
    mockUser(user);
    const start = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${assignmentId}/start`,
      { id: assignmentId },
      { method: 'POST' },
      cookie(),
    );
    const started = await assignmentStart(start.request, { params: start.params });
    expect(started.status, await started.clone().text()).toBe(200);
    const attempt = (await json<{ data: AttemptPayload }>(started)).data;
    const submit = createNextRequestWithParams(
      `http://localhost/api/v1/quiz/${attempt.id}`,
      { attemptId: attempt.id },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id, answers: [] }),
      },
      cookie(),
    );
    expect((await attemptSubmit(submit.request, { params: submit.params })).status).toBe(200);
    return attempt.questions.map((question) => question.id);
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 4 });
    cohort = [
      await before({ role: 'student' }),
      await before({ role: 'student' }),
      await before({ role: 'student' }),
      await before({ role: 'student' }),
      await before({ role: 'student' }),
    ];
    student = requiredAt(cohort, 0, 'the first student');
    colleague = await before({ role: 'educator' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    groupId = requiredAt(teacher.groups, 0, 'the seeded group');

    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    for (const member of cohort) {
      await seedOrgMembership({
        organizationId: orgId,
        userId: member.user.id,
        orgRoleId: asJson<{ id: string }>(memberRole).id,
      });
      await seedGroupMembership({ groupId, userId: member.user.id, role: 'member' });
    }
    await seedOrgMembership({
      organizationId: orgId,
      userId: colleague.user.id,
      orgRoleId: asJson<{ id: string }>(memberRole).id,
    });

    const { data: questionRows } = await service
      .from('questions')
      .select('id, bank_id')
      .eq('created_by', teacher.user.id)
      .order('id', { ascending: true });
    pool = asJson<Array<{ id: string }>>(questionRows ?? []).map((row) => row.id);
    const bankId = asJson<{ bank_id: string }>(
      requiredAt(questionRows, 0, 'a seeded question'),
    ).bank_id;
    await service.from('bank_groups').insert({ bank_id: bankId, group_id: groupId });
  });

  afterAll(async () => {
    for (const member of cohort) await cleanupQuizAttempts(member.user.id);
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('warns at publish with the pre-exposed count, and the staff ledger names the events', async () => {
    const seenItem = requiredAt(pool, 0, 'first item');
    const otherItem = requiredAt(pool, 1, 'second item');

    // One student sees both keys at the cohort reveal, which is the exposure the warning counts.
    const reviewed = await createAssessment(`fairness-reviewed-${Date.now()}`, [
      seenItem,
      otherItem,
    ]);
    expect((await publish(reviewed)).status).toBe(200);
    await sit(student.user, reviewed);

    mockUser(teacher.user);
    const closeCall = createNextRequestWithParams(
      `http://localhost/api/v1/teacher/assignments/${reviewed}/close`,
      { id: reviewed },
      { method: 'POST' },
      cookie(),
    );
    expect((await closePost(closeCall.request, { params: closeCall.params })).status).toBe(200);

    mockUser(student.user);
    const reviewCall = createNextRequestWithParams(
      `http://localhost/api/v1/assignments/${reviewed}/review`,
      { id: reviewed },
      {},
      cookie(),
    );
    expect((await reviewGet(reviewCall.request, { params: reviewCall.params })).status).toBe(200);

    // The draft that would grade the seen item again: the composer is told what is already burnt.
    const draft = await createAssessment(`fairness-draft-${Date.now()}`, [
      seenItem,
      requiredAt(pool, 2, 'third item'),
    ]);
    const detail = await detailOf(draft);
    expect(detail.status, await detail.clone().text()).toBe(200);
    const preExposure = (
      await json<{
        data: {
          preExposure?: Array<{
            groupId: string | null;
            studentId: string | null;
            seenItemCount: number;
            seenStudentCount: number;
          }>;
        };
      }>(detail)
    ).data.preExposure;
    expect(preExposure, 'a draft carries the warning').toHaveLength(1);
    expect(preExposure?.[0]).toMatchObject({
      groupId,
      studentId: null,
      seenItemCount: 1,
      seenStudentCount: 1,
    });

    // The warning is information in both modes: opting into unseen-only changes what the sample
    // excludes, never what the teacher is told about the class.
    const unseenDraft = await createAssessment(
      `fairness-draft-unseen-${Date.now()}`,
      [seenItem, requiredAt(pool, 2, 'third item')],
      { unseenOnly: true },
    );
    const unseenDetail = await detailOf(unseenDraft);
    expect(unseenDetail.status, await unseenDetail.clone().text()).toBe(200);
    expect(
      (
        await json<{
          data: {
            unseen_only: boolean;
            preExposure?: Array<{
              groupId: string | null;
              studentId: string | null;
              seenItemCount: number;
              seenStudentCount: number;
            }>;
          };
        }>(unseenDetail)
      ).data,
      'the counts do not depend on the sampling mode',
    ).toMatchObject({
      unseen_only: true,
      preExposure: [{ groupId, studentId: null, seenItemCount: 1, seenStudentCount: 1 }],
    });

    // The staff ledger: who saw the key, when, and the classes they shared with the run.
    mockUser(teacher.user);
    const ledgerCall = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${seenItem}/ledger`,
      { id: seenItem },
      {},
      cookie(),
    );
    const ledgerResponse = await ledgerGet(ledgerCall.request, { params: ledgerCall.params });
    expect(ledgerResponse.status, await ledgerResponse.clone().text()).toBe(200);
    const ledgerText = await ledgerResponse.clone().text();
    const ledger = await json<{
      data: {
        itemId: string;
        preExposedCount: number;
        events: Array<{
          studentId: string;
          studentEmail: string | null;
          seenCorrect: boolean;
          createdAt: string;
          groupIds: string[];
        }>;
      };
    }>(ledgerResponse);
    expect(ledger.data.itemId).toBe(seenItem);
    expect(ledger.data.preExposedCount).toBe(1);
    expect(ledger.data.events).toHaveLength(1);
    expect(ledger.data.events[0]).toMatchObject({
      studentId: student.user.id,
      studentEmail: student.user.email,
      seenCorrect: true,
      groupIds: [groupId],
    });
    expect(ledger.data.events[0]?.createdAt).toBeTruthy();
    // The ledger is an event list, not an answer sheet.
    expect(ledgerText).not.toMatch(/explanation|is_correct|correctOptionIds|model_answer/);

    // A student never reaches it, whatever the item.
    mockUser(student.user);
    const forbidden = await ledgerGet(ledgerCall.request, { params: ledgerCall.params });
    expect(forbidden.status, 'the ledger is staff-only').toBe(403);

    // Nor does staff without the key permission: the ledger names students, so reading it is the
    // same grant as reading the key.
    mockUser(colleague.user);
    const noKey = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${seenItem}/ledger`,
      { id: seenItem },
      {},
      cookie(),
    );
    const refused = await ledgerGet(noKey.request, { params: noKey.params });
    expect(refused.status, 'staff without the key permission are refused').toBe(403);

    // Publishing the draft freezes the decision, so the forecast is not re-served.
    expect((await publish(draft)).status).toBe(200);
    const published = await detailOf(draft);
    expect((await json<{ data: { preExposure?: unknown } }>(published)).data.preExposure).toBe(
      undefined,
    );
  });
});
