import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  cleanupFlashcardDecks,
  cleanupFlashcards,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import { POST as batchAction } from '@/app/(backend)/api/v1/flashcards/batch/[action]/route';
import { PUT as updateDeck } from '@/app/(backend)/api/v1/flashcards/decks/[id]/route';
import { POST as createDeck } from '@/app/(backend)/api/v1/flashcards/decks/route';

const suiteId = crypto.randomUUID().slice(0, 8);

/**
 * Regression coverage for #334: moving a card re-parents it (`flashcards.deck_id`
 * is a single NOT NULL FK). The move endpoint used to authorize the source card
 * with `flashcard.read`, so any group member could take a teacher-authored card
 * into a personal deck. The gate is now `flashcard.update` on every source card
 * plus `deck.update` on the target deck.
 */
describe(`Flashcard Move Authorization`, () => {
  let teacher!: BeforeResult;
  let member!: TestUserFixture;
  let foreignCardId!: string;
  let ownCardId!: string;
  let teacherDeckId!: string;
  let secondTeacherDeckId!: string;
  let memberDeckId!: string;

  const service = createServiceClient();

  function orgCookies() {
    return { active_org_id: teacher.orgId ?? '' };
  }

  async function deckIdOf(cardId: string): Promise<string | null> {
    const { data } = await service.from('flashcards').select('deck_id').eq('id', cardId).single();
    return (data?.deck_id as string | undefined) ?? null;
  }

  beforeAll(async () => {
    // Distinct org name so other suites' `seed-org-` cleanup cannot race us.
    teacher = await before({
      role: 'educator',
      org: `link-authz-org-${suiteId}`,
      decks: 2,
      flashcards: 2,
    });

    if (!teacher.orgId || !teacher.defaultGroupId) {
      throw new Error('[setup] org/group not created');
    }

    [teacherDeckId, secondTeacherDeckId] = teacher.created.decks;
    // seedViaApi distributes cards round-robin: card0 → deck0, card1 → deck1.
    [foreignCardId, ownCardId] = teacher.created.flashcards;
    if (!foreignCardId || !ownCardId || !teacherDeckId || !secondTeacherDeckId) {
      throw new Error('[setup] seeded fixtures missing');
    }

    // A student member of the teacher's org and of its default group — the S1
    // shape from the issue. Added via the service client because an educator
    // cannot manage group membership through the API (403).
    member = await createTestUser({ role: 'student' });
    const { data: memberRole } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', teacher.orgId)
      .eq('name', 'member')
      .single();
    if (!memberRole) throw new Error('[setup] member org role not found');

    const { error: memberError } = await service
      .from('org_members')
      .insert({ organization_id: teacher.orgId, user_id: member.id, org_role_id: memberRole.id });
    if (memberError) throw new Error(`[setup] org membership failed: ${memberError.message}`);

    const { error: groupError } = await service
      .from('group_members')
      .insert({ group_id: teacher.defaultGroupId, user_id: member.id, role: 'member' });
    if (groupError) throw new Error(`[setup] group membership failed: ${groupError.message}`);

    // Share deck0 with the member's group so the member can *read* the card.
    // Without this the read-visibility premise (and the old exploit) does not exist.
    mockUser(teacher.user);
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/flashcards/decks/${teacherDeckId}`,
      { id: teacherDeckId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visibility: 'group',
          groupIds: [teacher.defaultGroupId],
        }),
      },
      orgCookies(),
    );
    const shareRes = await updateDeck(request, { params });
    if (!shareRes.ok) {
      throw new Error(`[setup] deck share failed: ${shareRes.status} ${await shareRes.text()}`);
    }

    // A personal deck owned by the member — the move target from the issue.
    mockUser(member);
    const deckRes = await createDeck(
      createNextRequest(
        'http://localhost/api/v1/flashcards/decks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `link-authz-member-deck-${suiteId}` }),
        },
        orgCookies(),
      ),
    );
    const deckBody = await deckRes.json();
    if (!deckRes.ok || !deckBody.success) {
      throw new Error(`[setup] member deck creation failed: ${JSON.stringify(deckBody)}`);
    }
    memberDeckId = deckBody.data.id as string;
  });

  afterAll(async () => {
    await cleanupFlashcards(teacher.user.id);
    await cleanupFlashcardDecks(teacher.user.id);
    if (member) {
      await cleanupFlashcards(member.id);
      await cleanupFlashcardDecks(member.id);
    }
    if (teacher.orgId) await cleanupOrganizationDeep(teacher.orgId);
  });

  it('POST /api/v1/flashcards/batch/move returns 403 for a card the caller can only read', async () => {
    mockUser(member);

    const { request, params } = createNextRequestWithParams(
      'http://localhost/api/v1/flashcards/batch/move',
      { action: 'move' },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [foreignCardId],
          sourceDeckId: teacherDeckId,
          targetDeckId: memberDeckId,
        }),
      },
      orgCookies(),
    );
    const response = await batchAction(request, { params });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ success: false, error: 'FORBIDDEN' });
    expect(await deckIdOf(foreignCardId)).toBe(teacherDeckId);
  });

  it('POST /api/v1/flashcards/batch/move rejects the whole batch when one card can only be read', async () => {
    mockUser(member);

    const { request, params } = createNextRequestWithParams(
      'http://localhost/api/v1/flashcards/batch/move',
      { action: 'move' },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [foreignCardId, ownCardId],
          sourceDeckId: teacherDeckId,
          targetDeckId: memberDeckId,
        }),
      },
      orgCookies(),
    );
    const response = await batchAction(request, { params });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ success: false, error: 'FORBIDDEN' });
    expect(await deckIdOf(foreignCardId)).toBe(teacherDeckId);
    expect(await deckIdOf(ownCardId)).toBe(secondTeacherDeckId);
  });

  it('PUT /api/v1/flashcards/decks/:id returns 403 for foreign flashcardIds', async () => {
    mockUser(member);

    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/flashcards/decks/${memberDeckId}`,
      { id: memberDeckId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flashcardIds: [foreignCardId] }),
      },
      orgCookies(),
    );
    const response = await updateDeck(request, { params });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ success: false, error: 'FORBIDDEN' });
    expect(await deckIdOf(foreignCardId)).toBe(teacherDeckId);
  });

  it('POST /api/v1/flashcards/batch/move still works for a card the caller owns', async () => {
    mockUser(teacher.user);

    const { request, params } = createNextRequestWithParams(
      'http://localhost/api/v1/flashcards/batch/move',
      { action: 'move' },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [ownCardId],
          sourceDeckId: secondTeacherDeckId,
          targetDeckId: teacherDeckId,
        }),
      },
      orgCookies(),
    );
    const response = await batchAction(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ moved: 1 });
    expect(await deckIdOf(ownCardId)).toBe(teacherDeckId);
  });
});
