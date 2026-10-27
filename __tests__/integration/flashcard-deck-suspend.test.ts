import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import { GET as getById, PUT as update } from '@/app/(backend)/api/v1/flashcards/decks/[id]/route';
import { POST as batchAction } from '@/app/(backend)/api/v1/flashcards/decks/batch/[action]/route';
import {
  POST as createDeck,
  GET as listDecks,
} from '@/app/(backend)/api/v1/flashcards/decks/route';

const suiteId = crypto.randomUUID().slice(0, 8);

/**
 * #138: suspending a deck is a per-user preference (suspended_decks), so it must be
 * gated on deck.read — not deck.update — for both the single-deck PUT and the batch
 * endpoint. A group-shared deck must be suspendable by a member who can only read it,
 * while real content edits stay gated on deck.update and unreadable decks stay blocked.
 */
describe(`Flashcard Deck Suspend`, () => {
  let teacher!: BeforeResult;
  let orgId!: string;
  let groupA!: string;
  let studentA!: TestUserFixture;
  let studentB!: TestUserFixture;
  let deckId!: string;

  const service = createServiceClient();

  async function suspensionRow(userId: string): Promise<boolean> {
    const { data } = await service
      .from('suspended_decks')
      .select('deck_id')
      .eq('user_id', userId)
      .eq('deck_id', deckId)
      .maybeSingle();
    return data !== null;
  }

  async function listFor(user: TestUserFixture, includeSuspended = false) {
    mockUser(user);
    const res = await listDecks(
      createNextRequest(
        `http://localhost/api/v1/flashcards/decks${includeSuspended ? '?includeSuspended=true' : ''}`,
        undefined,
        { active_org_id: orgId },
      ),
    );
    return { res, body: await res.json() };
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
    const res = await update(request, { params });
    return { res, body: await res.json() };
  }

  async function batchFor(
    user: TestUserFixture,
    deckIds: string[],
    suspended: boolean,
    action = 'suspend',
  ) {
    mockUser(user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/flashcards/decks/batch/${action}`,
      { action },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckIds, suspended }),
      },
      { active_org_id: orgId },
    );
    const res = await batchAction(request, { params });
    return { res, body: await res.json() };
  }

  beforeAll(async () => {
    teacher = await before({
      role: 'educator',
      org: `deck-suspend-org-${suiteId}`,
      groups: 2,
    });
    orgId = teacher.orgId!;
    groupA = teacher.groups[1];
    const groupB = teacher.groups[2];

    // The API creates groups without enrolling their creator; deck group-sharing is
    // only allowed to groups the caller actually teaches (#140).
    {
      const { error } = await service
        .from('group_members')
        .insert({ group_id: groupA, user_id: teacher.user.id, role: 'teacher' });
      if (error) throw new Error(`[setup] teacher group membership failed: ${error.message}`);
    }

    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    if (!memberRole) throw new Error('[setup] member org role not found');

    studentA = await createTestUser({ role: 'student' });
    studentB = await createTestUser({ role: 'student' });

    for (const student of [studentA, studentB]) {
      const { error } = await service
        .from('org_members')
        .insert({ organization_id: orgId, user_id: student.id, org_role_id: memberRole.id });
      if (error) throw new Error(`[setup] org membership failed: ${error.message}`);
    }
    await service
      .from('group_members')
      .insert({ group_id: groupA, user_id: studentA.id, role: 'member' });
    await service
      .from('group_members')
      .insert({ group_id: groupB, user_id: studentB.id, role: 'member' });

    mockUser(teacher.user);
    const deckRes = await createDeck(
      createNextRequest(
        'http://localhost/api/v1/flashcards/decks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `deck-suspend-${suiteId}`,
            visibility: 'group',
            groupIds: [groupA],
          }),
        },
        { active_org_id: orgId },
      ),
    );
    const deckBody = await deckRes.json();
    if (!deckRes.ok || !deckBody.success) {
      throw new Error(`[setup] deck creation failed: ${JSON.stringify(deckBody)}`);
    }
    deckId = deckBody.data.id as string;
  });

  afterAll(async () => {
    await cleanupFlashcardDecks(teacher.user.id);
    await cleanupFlashcardDecks(studentA.id);
    await cleanupFlashcardDecks(studentB.id);
    await cleanupOrganizationDeep(orgId);
  });

  it('lets a group member suspend a shared deck they only read', async () => {
    const { res, body } = await putFor(studentA, { suspended: true });

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.suspended).toBe(true);
    expect(await suspensionRow(studentA.id)).toBe(true);
  });

  it('keeps suspension per-user: the owner still sees the deck and has no row', async () => {
    expect(await suspensionRow(teacher.user.id)).toBe(false);
    expect(await suspensionRow(studentB.id)).toBe(false);

    const { res, body } = await listFor(teacher.user);
    expect(res.status).toBe(200);
    const item = body.data.items.find((d: { id: string }) => d.id === deckId);
    expect(item).toBeDefined();
    expect(item.suspended).toBe(false);
  });

  it('hides the deck from the suspender by default and returns it with includeSuspended', async () => {
    const hidden = await listFor(studentA);
    expect(hidden.res.status).toBe(200);
    expect(hidden.body.data.items.some((d: { id: string }) => d.id === deckId)).toBe(false);

    const visible = await listFor(studentA, true);
    expect(visible.res.status).toBe(200);
    const item = visible.body.data.items.find((d: { id: string }) => d.id === deckId);
    expect(item).toBeDefined();
    expect(item.suspended).toBe(true);
  });

  it('lets the member unsuspend the shared deck', async () => {
    const { res, body } = await putFor(studentA, { suspended: false });

    expect(res.status).toBe(200);
    expect(body.data.suspended).toBe(false);
    expect(await suspensionRow(studentA.id)).toBe(false);

    const listed = await listFor(studentA);
    expect(listed.body.data.items.some((d: { id: string }) => d.id === deckId)).toBe(true);
  });

  it('still blocks content edits on a deck the member only reads', async () => {
    const { res, body } = await putFor(studentA, { name: 'Hacked' });

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(await suspensionRow(studentA.id)).toBe(false);

    const { data: deck } = await service
      .from('flashcard_decks')
      .select('name')
      .eq('id', deckId)
      .single();
    expect(deck?.name).toBe(`deck-suspend-${suiteId}`);
  });

  it('rejects a suspend body from a member of another group and writes no row', async () => {
    const { res, body } = await putFor(studentB, { suspended: true });

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(await suspensionRow(studentB.id)).toBe(false);

    const listed = await listFor(studentB, true);
    expect(listed.body.data.items.some((d: { id: string }) => d.id === deckId)).toBe(false);
  });

  it('applies the same read gate to the batch endpoint for the group member', async () => {
    const suspend = await batchFor(studentA, [deckId], true);
    expect(suspend.res.status).toBe(200);
    expect(suspend.body.data).toEqual({ updated: 1 });
    expect(await suspensionRow(studentA.id)).toBe(true);

    const unsuspend = await batchFor(studentA, [deckId], false);
    expect(unsuspend.res.status).toBe(200);
    expect(unsuspend.body.data).toEqual({ updated: 1 });
    expect(await suspensionRow(studentA.id)).toBe(false);
  });

  it('rejects batch suspension for an unreadable deck and writes no row', async () => {
    const { res, body } = await batchFor(studentB, [deckId], true);

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(await suspensionRow(studentB.id)).toBe(false);
  });

  it('returns 404 for a batch containing an unknown deck and writes nothing', async () => {
    const missing = '00000000-0000-4000-9000-000000000000';
    const { res, body } = await batchFor(studentA, [deckId, missing], true);

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(await suspensionRow(studentA.id)).toBe(false);
  });

  it('returns the deck with its per-user suspended flag on GET /decks/:id', async () => {
    await putFor(studentA, { suspended: true });

    mockUser(studentA);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/flashcards/decks/${deckId}`,
      { id: deckId },
      undefined,
      { active_org_id: orgId },
    );
    const res = await getById(request, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.suspended).toBe(true);

    await putFor(studentA, { suspended: false });
  });
});
