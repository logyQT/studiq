import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json } from '#test/helpers/json';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  cleanupFlashcardDecks,
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
import { contentFormPayload } from '@/lib/share-fields';

const suiteId = crypto.randomUUID().slice(0, 8);

/** Deck payload of `PUT /api/v1/flashcards/decks/:id` — the fields read below. */
interface DeckBody {
  success: boolean;
  data: { id: string; name: string; visibility: string; groupIds: string[] };
}

/**
 * #1555: a group-shared deck edited by an org Admin who does not teach the group. The dialog
 * re-sent the whole body, so the unchanged `groupIds` reached `canShareContentToGroups` and the
 * save answered 403. The body here comes from the dialog's own payload builder, because the
 * omission it performs is exactly what this file pins.
 */
describe(`Flashcard deck edit resaves the share set (#1555)`, () => {
  const service = createServiceClient();
  let teacher!: BeforeResult;
  let orgAdmin!: TestUserFixture;
  let orgId!: string;
  let groupA!: string;
  let groupB!: string;
  let deckId!: string;

  async function deckGroupIds(): Promise<string[]> {
    const { data } = await service.from('deck_groups').select('group_id').eq('deck_id', deckId);
    return (data ?? []).map((row) => row.group_id).toSorted();
  }

  async function putFor(user: TestUserFixture, body: Record<string, unknown>) {
    mockUser(user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/flashcards/decks/${deckId}`,
      { id: deckId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      { active_org_id: orgId },
    );
    const res = await updateDeck(request, { params });
    return { res, body: await json<DeckBody>(res) };
  }

  beforeAll(async () => {
    teacher = await before({
      role: 'educator',
      org: `deck-resave-org-${suiteId}`,
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

    mockUser(teacher.user);
    const deckRes = await createDeck(
      createNextRequest(
        'http://localhost/api/v1/flashcards/decks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `deck-resave-${suiteId}`,
            description: 'original',
            visibility: 'group',
            groupIds: [groupA, groupB],
          }),
        },
        { active_org_id: orgId },
      ),
    );
    const deckBody = await json<DeckBody>(deckRes);
    if (!deckRes.ok || !deckBody.success) {
      throw new Error(`[setup] deck creation failed: ${JSON.stringify(deckBody)}`);
    }
    deckId = deckBody.data.id;
  });

  afterAll(async () => {
    await cleanupFlashcardDecks(teacher.user.id);
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

  it('saves a name-only edit from the org Admin, who does not teach the group', async () => {
    const name = `deck-resave-${suiteId}-renamed`;
    const payload = contentFormPayload(
      { visibility: 'group', groupIds: [groupA, groupB] },
      // The picker returns the same groups in another order: still unchanged.
      { name, description: 'edited', visibility: 'group', groupIds: [groupB, groupA] },
    );

    const { res, body } = await putFor(orgAdmin, payload);

    expect(res.status).toBe(200);
    expect(body.data.name).toBe(name);

    const { data: stored } = await service
      .from('flashcard_decks')
      .select('name, description')
      .eq('id', deckId)
      .single();
    expect(stored).toEqual({ name, description: 'edited' });
    expect(await deckGroupIds()).toEqual([groupA, groupB].toSorted());
  });

  it('refuses a real share change from the org Admin', async () => {
    const payload = contentFormPayload(
      { visibility: 'group', groupIds: [groupA, groupB] },
      {
        name: `deck-resave-${suiteId}-renamed`,
        description: 'edited',
        visibility: 'group',
        groupIds: [groupA],
      },
    );

    const { res } = await putFor(orgAdmin, payload);

    expect(res.status).toBe(403);
    expect(await deckGroupIds()).toEqual([groupA, groupB].toSorted());
  });

  it('applies the same share change for the group teacher', async () => {
    const payload = contentFormPayload(
      { visibility: 'group', groupIds: [groupA, groupB] },
      {
        name: `deck-resave-${suiteId}-renamed`,
        description: 'edited',
        visibility: 'group',
        groupIds: [groupA],
      },
    );

    const { res, body } = await putFor(teacher.user, payload);

    expect(res.status).toBe(200);
    expect(body.data.groupIds).toEqual([groupA]);
    expect(await deckGroupIds()).toEqual([groupA]);
  });
});
