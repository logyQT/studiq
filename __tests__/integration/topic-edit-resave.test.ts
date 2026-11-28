import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json } from '#test/helpers/json';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  cleanupFlashcardTopics,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import {
  createNextRequest,
  createNextRequestWithParams,
  requiredAt,
} from '#test/integration/test-utils';
import { GET as getTopic, PUT as updateTopic } from '@/app/(backend)/api/v1/topics/[id]/route';
import { GET as listTopics, POST as createTopic } from '@/app/(backend)/api/v1/topics/route';
import { contentFormPayload } from '@/lib/share-fields';

const suiteId = crypto.randomUUID().slice(0, 8);

/** Topic payload of `GET/PUT /api/v1/topics/:id` — the fields read below. */
interface TopicBody {
  success: boolean;
  error?: string;
  data: { id: string; name: string; visibility: 'personal' | 'group'; groupIds: string[] };
}

/** `GET /api/v1/topics` payload — the fields read below. */
interface TopicListBody {
  success: boolean;
  data: { items: Array<{ id: string }> };
}

/**
 * #1556: a group-shared topic edited by an org Admin who does not teach the group. The dialog sent
 * `groupIds: []` with `visibility: 'group'`, so the update deleted the links and the topic silently
 * left its group. The body here comes from the dialog's own payload builder, and the stored share
 * set comes from the read the dialog opens with — both are what this file pins.
 */
describe(`Flashcard topic edit resaves the share set (#1556)`, () => {
  const service = createServiceClient();
  let teacher!: BeforeResult;
  let orgAdmin!: TestUserFixture;
  let member!: TestUserFixture;
  let orgId!: string;
  let groupA!: string;
  let groupB!: string;
  let topicId!: string;
  let personalTopicId!: string;

  async function topicGroupIds(id = topicId): Promise<string[]> {
    const { data } = await service.from('topic_groups').select('group_id').eq('topic_id', id);
    return (data ?? []).map((row) => row.group_id).toSorted();
  }

  async function getFor(user: TestUserFixture, id = topicId) {
    mockUser(user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/topics/${id}`,
      { id },
      { method: 'GET' },
      { active_org_id: orgId },
    );
    const res = await getTopic(request, { params });
    return { res, body: await json<TopicBody>(res) };
  }

  async function listFor(user: TestUserFixture) {
    mockUser(user);
    const res = await listTopics(
      createNextRequest('http://localhost/api/v1/topics', undefined, { active_org_id: orgId }),
    );
    return { res, body: await json<TopicListBody>(res) };
  }

  async function putFor(user: TestUserFixture, body: Record<string, unknown>, id = topicId) {
    mockUser(user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/topics/${id}`,
      { id },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      { active_org_id: orgId },
    );
    const res = await updateTopic(request, { params });
    return { res, body: await json<TopicBody>(res) };
  }

  beforeAll(async () => {
    teacher = await before({
      role: 'educator',
      org: `topic-resave-org-${suiteId}`,
      groups: 2,
    });
    orgId = teacher.orgId!;
    groupA = requiredAt(teacher.groups, 1, 'seeded group A');
    groupB = requiredAt(teacher.groups, 2, 'seeded group B');

    for (const groupId of [groupA, groupB]) {
      const { error } = await service
        .from('group_members')
        .insert({ group_id: groupId, user_id: teacher.user.id, role: 'teacher' });
      if (error) throw new Error(`[setup] teacher group membership failed: ${error.message}`);
    }

    const { data: adminRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'admin')
      .single();
    if (!adminRole) throw new Error('[setup] admin org role not found');

    // An org Admin who teaches no group: the caller the Edit dialog failed for.
    orgAdmin = await createTestUser({ role: 'educator' });
    const { error: memberError } = await service
      .from('org_members')
      .insert({ organization_id: orgId, user_id: orgAdmin.id, org_role_id: adminRole.id });
    if (memberError) throw new Error(`[setup] org membership failed: ${memberError.message}`);

    // A real learner in group A: the caller who must lose access when the share is revoked.
    const { data: learnerRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    if (!learnerRole) throw new Error('[setup] member org role not found');

    member = await createTestUser({ role: 'student' });
    const { error: learnerOrgError } = await service
      .from('org_members')
      .insert({ organization_id: orgId, user_id: member.id, org_role_id: learnerRole.id });
    if (learnerOrgError)
      throw new Error(`[setup] org membership failed: ${learnerOrgError.message}`);
    const { error: learnerGroupError } = await service
      .from('group_members')
      .insert({ group_id: groupA, user_id: member.id, role: 'member' });
    if (learnerGroupError) {
      throw new Error(`[setup] group membership failed: ${learnerGroupError.message}`);
    }

    mockUser(teacher.user);
    const topicRes = await createTopic(
      createNextRequest(
        'http://localhost/api/v1/topics',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `topic-resave-${suiteId}`,
            visibility: 'group',
            groupIds: [groupA, groupB],
          }),
        },
        { active_org_id: orgId },
      ),
    );
    const topicBody = await json<TopicBody>(topicRes);
    if (!topicRes.ok || !topicBody.success) {
      throw new Error(`[setup] topic creation failed: ${JSON.stringify(topicBody)}`);
    }
    topicId = topicBody.data.id;

    const personalRes = await createTopic(
      createNextRequest(
        'http://localhost/api/v1/topics',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `topic-personal-${suiteId}`, visibility: 'personal' }),
        },
        { active_org_id: orgId },
      ),
    );
    const personalBody = await json<TopicBody>(personalRes);
    if (!personalRes.ok || !personalBody.success) {
      throw new Error(`[setup] personal topic creation failed: ${JSON.stringify(personalBody)}`);
    }
    personalTopicId = personalBody.data.id;
  });

  afterAll(async () => {
    await cleanupFlashcardTopics(teacher.user.id);
    await cleanupOrganizationDeep(orgId);
  });

  it('gives the org Admin no group-teacher membership', async () => {
    const { data } = await service
      .from('group_members')
      .select('group_id')
      .eq('user_id', orgAdmin.id)
      .in('group_id', [groupA, groupB]);
    expect(data).toEqual([]);
  });

  it('returns the linked group ids, so the dialog can tell an unchanged set from an empty one', async () => {
    const { res, body } = await getFor(orgAdmin);

    expect(res.status).toBe(200);
    expect(body.data.groupIds).toEqual([groupA, groupB].toSorted());
  });

  it('saves a name-only edit from the org Admin, who does not teach the group', async () => {
    const read = await getFor(orgAdmin);
    const name = `topic-resave-${suiteId}-renamed`;
    const payload = contentFormPayload(
      { visibility: read.body.data.visibility, groupIds: read.body.data.groupIds },
      // The picker opens with the stored groups in another order: still unchanged.
      { name, visibility: 'group', groupIds: [groupB, groupA] },
    );

    const { res, body } = await putFor(orgAdmin, payload);

    expect(res.status).toBe(200);
    expect(body.data.name).toBe(name);

    const { data: stored } = await service.from('topics').select('name').eq('id', topicId).single();
    expect(stored).toEqual({ name });
    expect(await topicGroupIds()).toEqual([groupA, groupB].toSorted());
  });

  it('refuses a real share change from the org Admin, who does not teach the group', async () => {
    const read = await getFor(orgAdmin);
    const payload = contentFormPayload(
      { visibility: 'group', groupIds: read.body.data.groupIds },
      {
        name: `topic-resave-${suiteId}-renamed`,
        visibility: 'group',
        groupIds: [groupA],
      },
    );

    const { res } = await putFor(orgAdmin, payload);

    expect(res.status).toBe(403);
    expect(await topicGroupIds()).toEqual([groupA, groupB].toSorted());
  });

  it('applies the same share change for the group teacher', async () => {
    const payload = contentFormPayload(
      { visibility: 'group', groupIds: [groupA, groupB] },
      {
        name: `topic-resave-${suiteId}-renamed`,
        visibility: 'group',
        groupIds: [groupA],
      },
    );

    const { res, body } = await putFor(teacher.user, payload);

    expect(res.status).toBe(200);
    expect(body.data.groupIds).toEqual([groupA]);
    expect(await topicGroupIds()).toEqual([groupA]);
  });

  it('lets a member of the shared group read the topic while it is group-visible', async () => {
    const { res, body } = await getFor(member);

    expect(res.status).toBe(200);
    expect(body.data.groupIds).toEqual([groupA]);

    const listed = await listFor(member);
    expect(listed.res.status).toBe(200);
    expect(listed.body.data.items.some((topic) => topic.id === topicId)).toBe(true);
  });

  it('clears the links on a partial `{visibility: personal}` and revokes the group member', async () => {
    const { res, body } = await putFor(teacher.user, { visibility: 'personal' });

    expect(res.status).toBe(200);
    expect(body.data.visibility).toBe('personal');
    expect(body.data.groupIds).toEqual([]);
    expect(await topicGroupIds()).toEqual([]);

    const read = await getFor(member);
    expect(read.res.status).toBe(404);

    const listed = await listFor(member);
    expect(listed.res.status).toBe(200);
    expect(listed.body.data.items.some((topic) => topic.id === topicId)).toBe(false);
  });

  it('rejects `{visibility: group}` alone on a personal topic', async () => {
    const { res, body } = await putFor(teacher.user, { visibility: 'group' }, personalTopicId);

    expect(res.status).toBe(422);
    expect(res.headers.get('x-error-code')).toBe('UNPROCESSABLE_ENTITY');
    expect(body.error).toBe('UNPROCESSABLE_ENTITY');

    const stored = await getFor(teacher.user, personalTopicId);
    expect(stored.res.status).toBe(200);
    expect(stored.body.data.visibility).toBe('personal');
    expect(stored.body.data.groupIds).toEqual([]);
  });

  it('ignores a stale topic_groups row left on a personal topic (defense in depth)', async () => {
    const { error } = await service
      .from('topic_groups')
      .insert({ topic_id: personalTopicId, group_id: groupA });
    if (error) throw new Error(`[setup] stale link insert failed: ${error.message}`);

    const read = await getFor(member, personalTopicId);
    expect(read.res.status).toBe(404);

    const listed = await listFor(member);
    expect(listed.body.data.items.some((topic) => topic.id === personalTopicId)).toBe(false);
  });
});
