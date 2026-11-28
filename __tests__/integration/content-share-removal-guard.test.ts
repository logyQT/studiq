import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { json } from '#test/helpers/json';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  cleanupFlashcardDecks,
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
import { PUT as updateDeck } from '@/app/(backend)/api/v1/flashcards/decks/[id]/route';
import { POST as createDeck } from '@/app/(backend)/api/v1/flashcards/decks/route';
import { PUT as updateBank } from '@/app/(backend)/api/v1/questions/banks/[id]/route';
import { POST as createBank } from '@/app/(backend)/api/v1/questions/banks/route';
import { PUT as updateTopic } from '@/app/(backend)/api/v1/topics/[id]/route';
import { POST as createTopic } from '@/app/(backend)/api/v1/topics/route';

const suiteId = crypto.randomUUID().slice(0, 8);

interface ContentBody {
  success: boolean;
  error?: string;
  data: { id: string; name: string; visibility: string };
}

/**
 * #1562: adding a group to a share needed its teacher, removing one did not. A caller with
 * `update` at `organization` scope who taught no group could empty another teacher's share,
 * and the group's students lost the content. Every audience change — add, remove, replace, or
 * a flip to personal — now needs the caller to teach every group involved.
 */
describe(`Content share removal needs the group's teacher (#1562)`, () => {
  const service = createServiceClient();
  let teacher!: BeforeResult;
  let orgAdmin!: TestUserFixture;
  let orgId!: string;
  let groupA!: string;
  let groupB!: string;
  let deckId!: string;
  let topicId!: string;
  let bankId!: string;

  async function putFor(
    route: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
    id: string,
    user: TestUserFixture,
    body: Record<string, unknown>,
  ) {
    mockUser(user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/content/${id}`,
      { id },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      { active_org_id: orgId },
    );
    const res = await route(request, { params });
    return { res, body: await json<ContentBody>(res) };
  }

  async function groupIdsOf(
    table: 'deck_groups' | 'topic_groups' | 'bank_groups',
    column: 'deck_id' | 'topic_id' | 'bank_id',
    id: string,
  ) {
    const { data } = await service
      .from(table)
      .select('group_id')
      .eq(column, id)
      .overrideTypes<{ group_id: string }[], { merge: false }>();
    return (data ?? []).map((row) => row.group_id).toSorted();
  }

  async function storedVisibility(
    table: 'flashcard_decks' | 'topics' | 'question_banks',
    id: string,
  ) {
    const { data } = await service.from(table).select('visibility').eq('id', id).single();
    return data?.visibility ?? null;
  }

  async function createAsTeacher(
    route: (req: NextRequest) => Promise<Response>,
    body: Record<string, unknown>,
  ) {
    mockUser(teacher.user);
    const res = await route(
      createNextRequest(
        'http://localhost/api/v1/content',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        { active_org_id: orgId },
      ),
    );
    const parsed = await json<ContentBody>(res);
    if (!res.ok || !parsed.success) {
      throw new Error(`[setup] content creation failed: ${JSON.stringify(parsed)}`);
    }
    return parsed.data.id;
  }

  beforeAll(async () => {
    teacher = await before({
      role: 'educator',
      org: `share-removal-org-${suiteId}`,
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

    // An org Admin who holds `*.update` at organization scope and teaches no group.
    orgAdmin = await createTestUser({ role: 'educator' });
    const { error: memberError } = await service
      .from('org_members')
      .insert({ organization_id: orgId, user_id: orgAdmin.id, org_role_id: adminRole.id });
    if (memberError) throw new Error(`[setup] org membership failed: ${memberError.message}`);

    const shared = { visibility: 'group', groupIds: [groupA, groupB] };
    deckId = await createAsTeacher(createDeck, { name: `share-deck-${suiteId}`, ...shared });
    topicId = await createAsTeacher(createTopic, { name: `share-topic-${suiteId}`, ...shared });
    bankId = await createAsTeacher(createBank, { name: `share-bank-${suiteId}`, ...shared });
  });

  afterAll(async () => {
    await cleanupFlashcardDecks(teacher.user.id);
    await cleanupFlashcardTopics(teacher.user.id);
    await service.from('question_banks').delete().eq('created_by', teacher.user.id);
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

  it('lets the org Admin rename a deck without a share guard', async () => {
    const name = `share-deck-${suiteId}-renamed`;
    const { res, body } = await putFor(updateDeck, deckId, orgAdmin, { name });

    expect(res.status).toBe(200);
    expect(body.data.name).toBe(name);
    expect(await groupIdsOf('deck_groups', 'deck_id', deckId)).toEqual([groupA, groupB].toSorted());
  });

  it('refuses the org Admin an unshare of the deck to personal', async () => {
    const { res, body } = await putFor(updateDeck, deckId, orgAdmin, { visibility: 'personal' });

    expect(res.status).toBe(403);
    expect(body.error).toBe('FORBIDDEN');
    expect(await storedVisibility('flashcard_decks', deckId)).toBe('group');
    expect(await groupIdsOf('deck_groups', 'deck_id', deckId)).toEqual([groupA, groupB].toSorted());
  });

  it("lets the deck's teacher unshare it to personal", async () => {
    const { res, body } = await putFor(updateDeck, deckId, teacher.user, {
      visibility: 'personal',
    });

    expect(res.status).toBe(200);
    expect(body.data.visibility).toBe('personal');
    expect(await groupIdsOf('deck_groups', 'deck_id', deckId)).toEqual([]);
  });

  it('lets the org Admin rename a topic without a share guard', async () => {
    const name = `share-topic-${suiteId}-renamed`;
    const { res, body } = await putFor(updateTopic, topicId, orgAdmin, { name });

    expect(res.status).toBe(200);
    expect(body.data.name).toBe(name);
    expect(await groupIdsOf('topic_groups', 'topic_id', topicId)).toEqual(
      [groupA, groupB].toSorted(),
    );
  });

  it('rejects an empty topic groupIds list before the guard runs', async () => {
    // #1556: a `group` topic cannot drop its last link in place; the unshare is the
    // visibility flip below, so this body answers 422 and the guard never runs.
    const { res, body } = await putFor(updateTopic, topicId, orgAdmin, { groupIds: [] });

    expect(res.status).toBe(422);
    expect(body.error).toBe('UNPROCESSABLE_ENTITY');
    expect(await groupIdsOf('topic_groups', 'topic_id', topicId)).toEqual(
      [groupA, groupB].toSorted(),
    );
  });

  it('refuses the org Admin flipping a group topic to personal', async () => {
    const { res, body } = await putFor(updateTopic, topicId, orgAdmin, { visibility: 'personal' });

    expect(res.status).toBe(403);
    expect(body.error).toBe('FORBIDDEN');
    expect(await storedVisibility('topics', topicId)).toBe('group');
    expect(await groupIdsOf('topic_groups', 'topic_id', topicId)).toEqual(
      [groupA, groupB].toSorted(),
    );
  });

  it("lets the topic's teacher empty the share", async () => {
    const { res, body } = await putFor(updateTopic, topicId, teacher.user, {
      visibility: 'personal',
    });

    expect(res.status).toBe(200);
    expect(body.data.visibility).toBe('personal');
    expect(await groupIdsOf('topic_groups', 'topic_id', topicId)).toEqual([]);
  });

  it('lets the org Admin rename a question bank without a share guard', async () => {
    const name = `share-bank-${suiteId}-renamed`;
    const { res, body } = await putFor(updateBank, bankId, orgAdmin, { name });

    expect(res.status).toBe(200);
    expect(body.data.name).toBe(name);
    expect(await groupIdsOf('bank_groups', 'bank_id', bankId)).toEqual([groupA, groupB].toSorted());
  });

  it('rejects an empty bank groupIds list before the guard runs', async () => {
    // #1566: a `group` bank cannot drop its last link in place, the same rule a deck and a
    // topic follow; the unshare is the visibility flip below, so this body answers 422.
    const { res, body } = await putFor(updateBank, bankId, orgAdmin, { groupIds: [] });

    expect(res.status).toBe(422);
    expect(body.error).toBe('UNPROCESSABLE_ENTITY');
    expect(await groupIdsOf('bank_groups', 'bank_id', bankId)).toEqual([groupA, groupB].toSorted());
  });

  it('refuses the org Admin unsharing a question bank to personal', async () => {
    const { res, body } = await putFor(updateBank, bankId, orgAdmin, { visibility: 'personal' });

    expect(res.status).toBe(403);
    expect(body.error).toBe('FORBIDDEN');
    expect(await storedVisibility('question_banks', bankId)).toBe('group');
    expect(await groupIdsOf('bank_groups', 'bank_id', bankId)).toEqual([groupA, groupB].toSorted());
  });

  it("lets the question bank's teacher unshare it to personal", async () => {
    const { res, body } = await putFor(updateBank, bankId, teacher.user, {
      visibility: 'personal',
    });

    expect(res.status).toBe(200);
    expect(body.data.visibility).toBe('personal');
    expect(await groupIdsOf('bank_groups', 'bank_id', bankId)).toEqual([]);
  });
});
