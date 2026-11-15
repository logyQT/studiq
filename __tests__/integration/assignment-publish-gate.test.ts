import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { GET as assignmentGet } from '@/app/(backend)/api/v1/teacher/assignments/[id]/route';
import { POST as createAssignmentPost } from '@/app/(backend)/api/v1/teacher/assignments/route';
import { POST as addQuestionsPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/questions/route';
import { POST as publishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/publish/route';
import { PUT as targetsPut } from '@/app/(backend)/api/v1/teacher/assignments/[id]/targets/route';
import { POST as unpublishPost } from '@/app/(backend)/api/v1/teacher/assignments/[id]/unpublish/route';
import { GET as questionsList } from '@/app/(backend)/api/v1/questions/route';
import { GET as questionGet } from '@/app/(backend)/api/v1/questions/[id]/route';

// #1171 slice 2b: the publish gate (R3/R12/R13/R19). Validation names the field that is wrong,
// cross-class exposure is blocking, the org-wide seal widens the reservation, and publish-once
// applies from live. The seam is the real route → controller → service stack.

const DEADLINE = () => new Date(Date.now() + 2 * 86_400_000).toISOString();
const FUTURE_START = () => new Date(Date.now() + 86_400_000).toISOString();

interface PublishBody {
  deadline?: string;
  startTime?: string;
  acknowledgeExposure?: boolean;
  sealOrgWide?: boolean;
}

interface DetailPayload {
  id: string;
  status: string;
  seal_org_wide?: boolean;
  exposure?: { openItemCount: number; outsideStudentCount: number };
}

/** The next request runs as this user. */
function as(user: BeforeResult['user']): void {
  mockUser(user);
}

/** The `path` entries of the 422 issues, so a refusal names what to fix. */
function issuePaths(body: { issues?: unknown }): string[] {
  const { properties } = (body.issues ?? {}) as {
    properties?: Record<string, { errors?: string[] }>;
  };
  return Object.entries(properties ?? {})
    .filter(([, value]) => (value.errors ?? []).length > 0)
    .map(([field]) => field)
    .toSorted();
}

describe('Assessment publish gate (#1171)', () => {
  const service = createServiceClient();

  let teacher!: BeforeResult;
  let outsider!: BeforeResult;
  let classStudent!: BeforeResult;
  let orgId!: string;
  let groupA!: string;
  let outsiderGroup!: string;
  let memberRoleId!: string;
  let questionId!: string;
  let bankId!: string;

  const cookie = () => ({ active_org_id: orgId });

  async function request(
    route: (req: ReturnType<typeof createNextRequest>) => Promise<Response>,
    url: string,
    init: RequestInit = {},
  ): Promise<{
    status: number;
    body: { success: boolean; data?: T; error?: string; issues?: unknown };
  }> {
    const response = await route(createNextRequest(url, init, cookie()));
    const body = await json<{ success: boolean; data?: T; error?: string; issues?: unknown }>(
      response,
    );
    return { status: response.status, body };
  }

  async function withParams(
    route: (
      req: ReturnType<typeof createNextRequestWithParams>['request'],
      ctx: { params: ReturnType<typeof createNextRequestWithParams>['params'] },
    ) => Promise<Response>,
    url: string,
    id: string,
    init: RequestInit = {},
  ): Promise<{
    status: number;
    body: { success: boolean; data?: T; error?: string; issues?: unknown };
  }> {
    const call = createNextRequestWithParams(url, { id }, init, cookie());
    const response = await route(call.request, { params: call.params });
    const body = await json<{ success: boolean; data?: T; error?: string; issues?: unknown }>(
      response,
    );
    return { status: response.status, body };
  }

  async function createDraft(): Promise<string> {
    const created = await request<{ id: string }>(
      createAssignmentPost,
      'http://localhost/api/v1/teacher/assignments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `gate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        }),
      },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return asJson<{ id: string }>(created.body.data).id;
  }

  async function target(assignmentId: string, groupIds: string[]): Promise<void> {
    const response = await withParams(
      targetsPut,
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/targets`,
      assignmentId,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds }),
      },
    );
    expect(response.status).toBe(200);
  }

  /** The target PUT without its status asserted: the refusal tests read it themselves. */
  async function setTargets(assignmentId: string, groupIds: string[]) {
    return withParams(
      targetsPut,
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/targets`,
      assignmentId,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds }),
      },
    );
  }

  async function questionStatus(id: string): Promise<number> {
    const call = createNextRequestWithParams(
      `http://localhost/api/v1/questions/${id}`,
      { id },
      {},
      cookie(),
    );
    return (await questionGet(call.request, { params: call.params })).status;
  }

  async function addItem(assignmentId: string, ids: string[]): Promise<void> {
    const response = await withParams(
      addQuestionsPost,
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/questions`,
      assignmentId,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds: ids }),
      },
    );
    expect(response.status).toBe(200);
  }

  async function publish(assignmentId: string, body: PublishBody = {}) {
    return withParams(
      publishPost,
      `http://localhost/api/v1/teacher/assignments/${assignmentId}/publish`,
      assignmentId,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  }

  beforeAll(async () => {
    teacher = await before({ role: 'educator', org: true, groups: 1, questions: 1 });
    outsider = await before({ role: 'student' });
    if (!teacher.orgId) throw new Error('the teacher fixture has no organisation');
    orgId = teacher.orgId;
    groupA = requiredAt(teacher.groups, 0, 'the seeded extra group');
    questionId = requiredAt(teacher.created.questions, 0, 'the seeded question');

    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    memberRoleId = asJson<{ id: string }>(memberRole).id;
    await seedOrgMembership({
      organizationId: orgId,
      userId: outsider.user.id,
      orgRoleId: memberRoleId,
    });

    const { data: bankRow } = await service
      .from('questions')
      .select('bank_id')
      .eq('id', questionId)
      .single();
    bankId = asJson<{ bank_id: string }>(bankRow).bank_id;

    // The fixture bank is shared with a second class that is *not* in the cohort: that is exactly
    // the cross-class exposure the gate asks about.
    const { data: outsiderGroupRow, error: groupError } = await service
      .from('groups')
      .insert({ organization_id: orgId, name: `gate-8b-${Date.now()}` })
      .select('id')
      .single();
    if (groupError) throw new Error(`group: ${groupError.message}`);
    outsiderGroup = outsiderGroupRow.id;
    await seedGroupMembership({
      groupId: outsiderGroup,
      userId: outsider.user.id,
      role: 'member',
    });
    await service.from('bank_groups').insert([
      { bank_id: bankId, group_id: groupA },
      { bank_id: bankId, group_id: outsiderGroup },
    ]);

    // A student in the class the run targets, so a re-targeting that drops 8A is observable as
    // the item becoming readable again.
    classStudent = await before({ role: 'student' });
    await seedOrgMembership({
      organizationId: orgId,
      userId: classStudent.user.id,
      orgRoleId: memberRoleId,
    });
    await seedGroupMembership({ groupId: groupA, userId: classStudent.user.id, role: 'member' });

    as(teacher.user);
  });

  afterAll(async () => {
    await cleanupTeacherAssignments(teacher.user.id);
    await cleanupQuestions(teacher.user.id, 'seed-question-');
    await cleanupOrganizationDeep(orgId);
  });

  it('refuses a publish with no targets, no items or no close, naming each field', async () => {
    const empty = await createDraft();
    const noTargets = await publish(empty, { deadline: DEADLINE() });
    expect(noTargets.status, JSON.stringify(noTargets.body)).toBe(422);
    expect(issuePaths(noTargets.body)).toContain('targets');

    await target(empty, [groupA]);
    const noItems = await publish(empty, { deadline: DEADLINE() });
    expect(noItems.status, 'a targeted zero-item assessment cannot be published').toBe(422);
    expect(issuePaths(noItems.body)).toContain('items');

    await addItem(empty, [questionId]);
    const noDeadline = await publish(empty);
    expect(noDeadline.status, 'a published run must be able to close').toBe(422);
    expect(issuePaths(noDeadline.body)).toContain('deadline');
  });

  it('refuses a window that closes before it opens', async () => {
    const draft = await createDraft();
    await target(draft, [groupA]);
    await addItem(draft, [questionId]);

    const inverted = await publish(draft, {
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
      startTime: FUTURE_START(),
      acknowledgeExposure: true,
    });
    expect(inverted.status).toBe(422);
    expect(issuePaths(inverted.body)).toEqual(['startTime']);
  });

  it('refuses max_attempts below one', async () => {
    const draft = await createDraft();
    await target(draft, [groupA]);
    await addItem(draft, [questionId]);
    await service.from('teacher_assignments').update({ max_attempts: 0 }).eq('id', draft);

    const refused = await publish(draft, { deadline: DEADLINE(), acknowledgeExposure: true });
    expect(refused.status).toBe(422);
    expect(issuePaths(refused.body)).toEqual(['maxAttempts']);
  });

  it('blocks a publish whose items another class can still practise', async () => {
    const draft = await createDraft();
    await target(draft, [groupA]);
    await addItem(draft, [questionId]);

    const blocked = await publish(draft, { deadline: DEADLINE() });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
    expect(blocked.body.error).toBe('EXPOSURE_ACK_REQUIRED');
    expect((await assignmentGetDetail(draft)).status).toBe('draft');

    const acknowledged = await publish(draft, {
      deadline: DEADLINE(),
      acknowledgeExposure: true,
    });
    expect(acknowledged.status, JSON.stringify(acknowledged.body)).toBe(200);
    expect((await assignmentGetDetail(draft)).status).toBe('published');
    expect((await assignmentGetDetail(draft)).seal_org_wide).toBe(false);
  });

  it('reports the forecast the composer renders, without an item id', async () => {
    const draft = await createDraft();
    await target(draft, [groupA]);
    await addItem(draft, [questionId]);

    const detail = await assignmentGetDetail(draft);
    expect(detail.exposure?.openItemCount).toBeGreaterThan(0);
    expect(detail.exposure?.outsideStudentCount).toBeGreaterThan(0);
    // The forecast is counts only: it never names an item or a student.
    expect(JSON.stringify(detail.exposure)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('needs no acknowledgement once the run is sealed for the whole organisation', async () => {
    const draft = await createDraft();
    await target(draft, [groupA]);
    await addItem(draft, [questionId]);

    const sealedOrg = await publish(draft, { deadline: DEADLINE(), sealOrgWide: true });
    expect(sealedOrg.status, JSON.stringify(sealedOrg.body)).toBe(200);
    expect((await assignmentGetDetail(draft)).seal_org_wide).toBe(true);

    // The outsider is in the organisation and not targeted, yet the item is held from them too.
    as(outsider.user);
    const listRequest = createNextRequest(
      `http://localhost/api/v1/questions?bankId=${bankId}&page=1&limit=25`,
      {},
      cookie(),
    );
    const response = await questionsList(listRequest);
    expect(response.status).toBe(200);
    const page = (await json<{ data: { items: Array<{ id: string }> } }>(response)).data;
    expect(page.items.map((item) => item.id)).not.toContain(questionId);
    as(teacher.user);
  });

  it('refuses any target change on a published run (R20)', async () => {
    const live = await createDraft();
    await target(live, [groupA]);
    await addItem(live, [questionId]);
    expect((await publish(live, { deadline: DEADLINE(), acknowledgeExposure: true })).status).toBe(
      200,
    );

    // The run is live: the targeted class cannot reach the held item.
    as(classStudent.user);
    expect(await questionStatus(questionId), 'the held item is 404 for the target class').toBe(404);
    as(teacher.user);

    // Replacing the cohort would unseal the dropped class mid-window.
    const replaced = await setTargets(live, [outsiderGroup]);
    expect(replaced.status, 're-targeting a published run').toBe(409);
    expect(replaced.body.error).toBe('ASSESSMENT_LIVE');

    // An empty list would withdraw the run through the draft branch.
    const emptied = await setTargets(live, []);
    expect(emptied.status, 'emptying a published run’s cohort').toBe(409);
    expect(emptied.body.error).toBe('ASSESSMENT_LIVE');

    expect((await assignmentGetDetail(live)).status, 'the status was never touched').toBe(
      'published',
    );

    // A refused PUT left the run exactly as it was: the class is still sealed.
    as(classStudent.user);
    expect(await questionStatus(questionId), 'the target class is still sealed').toBe(404);
    as(teacher.user);

    // A draft is still editable, which is how a wrong cohort is corrected before publish.
    const draft = await createDraft();
    await target(draft, [groupA]);
  });

  it('is publish-once from live, and a scheduled run withdraws to draft', async () => {
    const live = await createDraft();
    await target(live, [groupA]);
    await addItem(live, [questionId]);
    expect((await publish(live, { deadline: DEADLINE(), acknowledgeExposure: true })).status).toBe(
      200,
    );

    const again = await publish(live, { deadline: DEADLINE(), acknowledgeExposure: true });
    expect(again.status, 'publishing a live run again').toBe(409);
    expect(again.body.error).toBe('ASSESSMENT_ALREADY_PUBLISHED');

    const withdrawLive = await withParams(
      unpublishPost,
      `http://localhost/api/v1/teacher/assignments/${live}/unpublish`,
      live,
      { method: 'POST' },
    );
    expect(withdrawLive.status, 'a live run cannot be withdrawn').toBe(409);
    expect(withdrawLive.body.error).toBe('ASSESSMENT_LIVE');

    // A scheduled run has no exposure yet: withdraw it, fix it, publish it again.
    const scheduled = await createDraft();
    await target(scheduled, [groupA]);
    await addItem(scheduled, [questionId]);
    const start = FUTURE_START();
    expect(
      (
        await publish(scheduled, {
          deadline: DEADLINE(),
          startTime: start,
          acknowledgeExposure: true,
        })
      ).status,
    ).toBe(200);

    const withdraw = await withParams(
      unpublishPost,
      `http://localhost/api/v1/teacher/assignments/${scheduled}/unpublish`,
      scheduled,
      { method: 'POST' },
    );
    expect(withdraw.status, JSON.stringify(withdraw.body)).toBe(200);
    expect((await assignmentGetDetail(scheduled)).status).toBe('draft');

    const republished = await publish(scheduled, {
      deadline: DEADLINE(),
      startTime: start,
      acknowledgeExposure: true,
    });
    expect(republished.status, JSON.stringify(republished.body)).toBe(200);
  });

  async function assignmentGetDetail(id: string): Promise<DetailPayload> {
    const detail = await withParams(
      assignmentGet,
      `http://localhost/api/v1/teacher/assignments/${id}`,
      id,
    );
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    return asJson<DetailPayload>(detail.body.data);
  }
});
