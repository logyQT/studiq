import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
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
import { POST as createCard } from '@/app/(backend)/api/v1/flashcards/route';
import { GET as getCardById } from '@/app/(backend)/api/v1/flashcards/[id]/route';
import {
  GET as getDeckById,
  PUT as updateDeck,
} from '@/app/(backend)/api/v1/flashcards/decks/[id]/route';
import {
  GET as listDecks,
  POST as createDeck,
} from '@/app/(backend)/api/v1/flashcards/decks/route';

/**
 * #141: a partial `PUT { visibility: 'personal' }` used to leave the `deck_groups` rows
 * intact, and the group-scope read filter derived access purely from that join table —
 * so group members kept seeing/opening a deck the teacher marked "only me".
 *
 * The service now reconciles links from the resulting visibility, and the authz layer
 * only honours a share link while the deck is actually group-visible (defense in depth
 * for rows already corrupted by an earlier partial PUT).
 */
forEachCopy((copyId) => {
  describe(`Flashcard Deck Visibility [${copyId}]`, () => {
    registerMock(copyId, null);

    let teacher!: BeforeResult;
    let orgId!: string;
    let groupA!: string;
    let studentA!: TestUserFixture;
    let studentB!: TestUserFixture;
    let deckId!: string;
    let cardId!: string;

    const service = createServiceClient();

    async function listFor(user: TestUserFixture) {
      mockUser(user);
      const res = await listDecks(
        createNextRequest('http://localhost/api/v1/flashcards/decks', undefined, {
          active_org_id: orgId,
        }),
      );
      return { res, body: await res.json() };
    }

    async function getDeckFor(user: TestUserFixture) {
      mockUser(user);
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deckId}`,
        { id: deckId },
        undefined,
        { active_org_id: orgId },
      );
      const res = await getDeckById(request, { params });
      return { res, body: await res.json() };
    }

    async function getCardFor(user: TestUserFixture) {
      mockUser(user);
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${cardId}`,
        { id: cardId },
        undefined,
        { active_org_id: orgId },
      );
      const res = await getCardById(request, { params });
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
      const res = await updateDeck(request, { params });
      return { res, body: await res.json() };
    }

    async function deckGroupIds(): Promise<string[]> {
      const { data } = await service.from('deck_groups').select('group_id').eq('deck_id', deckId);
      return (data ?? []).map((r) => r.group_id as string);
    }

    async function cardVisibility(): Promise<string | null> {
      const { data } = await service
        .from('flashcards')
        .select('visibility')
        .eq('id', cardId)
        .single();
      return (data?.visibility as string | undefined) ?? null;
    }

    beforeAll(async () => {
      teacher = await before({
        role: 'educator',
        org: `deck-visibility-org-${copyId}`,
        groups: 1,
      });
      orgId = teacher.orgId!;
      groupA = teacher.groups[1];

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

      mockUser(teacher.user);
      const deckRes = await createDeck(
        createNextRequest(
          'http://localhost/api/v1/flashcards/decks',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `deck-visibility-${copyId}`,
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

      mockUser(teacher.user);
      const cardRes = await createCard(
        createNextRequest(
          'http://localhost/api/v1/flashcards',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deckId, front: 'front-141', back: 'back-141' }),
          },
          { active_org_id: orgId },
        ),
      );
      const cardBody = await cardRes.json();
      if (!cardRes.ok || !cardBody.success) {
        throw new Error(`[setup] card creation failed: ${JSON.stringify(cardBody)}`);
      }
      cardId = cardBody.data.id as string;
    });

    afterAll(async () => {
      await cleanupFlashcards(teacher.user.id);
      await cleanupFlashcardDecks(teacher.user.id);
      await cleanupOrganizationDeep(orgId);
    });

    it('lets a group member read the shared deck and its card while it is group-visible', async () => {
      const listed = await listFor(studentA);
      expect(listed.res.status).toBe(200);
      expect(listed.body.data.items.some((d: { id: string }) => d.id === deckId)).toBe(true);

      expect((await getDeckFor(studentA)).res.status).toBe(200);
      expect((await getCardFor(studentA)).res.status).toBe(200);
    });

    it('clears the share links when a partial PUT switches the deck to personal', async () => {
      const { res, body } = await putFor(teacher.user, { visibility: 'personal' });

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.visibility).toBe('personal');
      expect(body.data.groupIds).toEqual([]);
      expect(await deckGroupIds()).toEqual([]);
      // The deck's cards follow the deck to personal.
      expect(await cardVisibility()).toBe('personal');
    });

    it('revokes a group member’s access once the deck is personal', async () => {
      const listed = await listFor(studentA);
      expect(listed.res.status).toBe(200);
      expect(listed.body.data.items.some((d: { id: string }) => d.id === deckId)).toBe(false);

      const deck = await getDeckFor(studentA);
      expect(deck.res.status).toBe(404);

      const card = await getCardFor(studentA);
      expect(card.res.status).toBe(404);
    });

    it('ignores a stale deck_groups row left on a personal deck (defense in depth)', async () => {
      const { error } = await service
        .from('deck_groups')
        .insert({ deck_id: deckId, group_id: groupA });
      if (error) throw new Error(`[setup] legacy link insert failed: ${error.message}`);

      const listed = await listFor(studentA);
      expect(listed.body.data.items.some((d: { id: string }) => d.id === deckId)).toBe(false);
      expect((await getDeckFor(studentA)).res.status).toBe(404);
      expect((await getCardFor(studentA)).res.status).toBe(404);
    });

    it('restores member access when the deck is shared to the group again', async () => {
      const { res, body } = await putFor(teacher.user, {
        visibility: 'group',
        groupIds: [groupA],
      });

      expect(res.status).toBe(200);
      expect(body.data.visibility).toBe('group');
      expect(body.data.groupIds).toEqual([groupA]);
      expect(await deckGroupIds()).toEqual([groupA]);

      const listed = await listFor(studentA);
      expect(listed.body.data.items.some((d: { id: string }) => d.id === deckId)).toBe(true);
      expect((await getDeckFor(studentA)).res.status).toBe(200);
      expect((await getCardFor(studentA)).res.status).toBe(200);
    });

    it('keeps the links on a groupIds-only update and on a name-only update', async () => {
      const relinked = await putFor(teacher.user, { groupIds: [groupA] });
      expect(relinked.res.status).toBe(200);
      expect(relinked.body.data.groupIds).toEqual([groupA]);

      const renamed = await putFor(teacher.user, { name: `deck-visibility-${copyId}-renamed` });
      expect(renamed.res.status).toBe(200);
      expect(renamed.body.data.groupIds).toEqual([groupA]);
      expect(await deckGroupIds()).toEqual([groupA]);

      const listed = await listFor(studentA);
      expect(listed.body.data.items.some((d: { id: string }) => d.id === deckId)).toBe(true);
    });

    it('keeps the deck hidden from a student outside the shared group', async () => {
      const listed = await listFor(studentB);
      expect(listed.body.data.items.some((d: { id: string }) => d.id === deckId)).toBe(false);
      expect((await getDeckFor(studentB)).res.status).toBe(404);
    });
  });
});
