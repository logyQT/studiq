import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  cleanupFlashcardDecks,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import {
  GET as getDeckById,
  PUT as updateDeck,
} from '@/app/(backend)/api/v1/flashcards/decks/[id]/route';
import { POST as createDeck } from '@/app/(backend)/api/v1/flashcards/decks/route';

/**
 * #139: a deck could be created with `visibility = 'group'` and no `groupIds`, which left
 * it with zero `deck_groups` rows — shared in name only, readable by its creator alone.
 *
 * Creation and update now reject that state with 422 instead of storing a misleading row.
 */
forEachCopy((copyId) => {
  describe(`Flashcard Deck Group Required [${copyId}]`, () => {
    registerMock(copyId, null);

    let teacher!: BeforeResult;
    let orgId!: string;
    let groupId!: string;

    const service = createServiceClient();

    async function postDeck(body: Record<string, unknown>) {
      mockUser(teacher.user);
      const res = await createDeck(
        createNextRequest(
          'http://localhost/api/v1/flashcards/decks',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
          { active_org_id: orgId },
        ),
      );
      return { res, body: await res.json() };
    }

    async function putDeck(deckId: string, body: Record<string, unknown>) {
      mockUser(teacher.user);
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

    async function getDeck(deckId: string) {
      mockUser(teacher.user);
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deckId}`,
        { id: deckId },
        undefined,
        { active_org_id: orgId },
      );
      const res = await getDeckById(request, { params });
      return { res, body: await res.json() };
    }

    async function deckGroupIds(deckId: string): Promise<string[]> {
      const { data } = await service.from('deck_groups').select('group_id').eq('deck_id', deckId);
      return (data ?? []).map((r) => r.group_id as string);
    }

    async function storedDeckByName(name: string) {
      const { data } = await service
        .from('flashcard_decks')
        .select('id, visibility')
        .eq('created_by', teacher.user.id)
        .eq('name', name);
      return data ?? [];
    }

    beforeAll(async () => {
      teacher = await before({
        role: 'educator',
        org: `deck-group-required-org-${copyId}`,
        groups: 1,
      });
      orgId = teacher.orgId!;
      groupId = teacher.groups[1];

      // The API creates groups without enrolling their creator; deck group-sharing is
      // only allowed to groups the caller actually teaches (#140).
      const { error } = await service
        .from('group_members')
        .insert({ group_id: groupId, user_id: teacher.user.id, role: 'teacher' });
      if (error) throw new Error(`[setup] teacher group membership failed: ${error.message}`);
    });

    afterAll(async () => {
      await cleanupFlashcardDecks(teacher.user.id);
      await cleanupOrganizationDeep(orgId);
    });

    it('rejects a group deck with no groupIds field', async () => {
      const name = `group-required-missing-${copyId}`;
      const { res, body } = await postDeck({ name, visibility: 'group' });

      expect(res.status).toBe(422);
      expect(res.headers.get('x-error-code')).toBe('UNPROCESSABLE_ENTITY');
      expect(body.success).toBe(false);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(await storedDeckByName(name)).toEqual([]);
    });

    it('rejects a group deck with an empty groupIds list', async () => {
      const name = `group-required-empty-${copyId}`;
      const { res, body } = await postDeck({ name, visibility: 'group', groupIds: [] });

      expect(res.status).toBe(422);
      expect(res.headers.get('x-error-code')).toBe('UNPROCESSABLE_ENTITY');
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(await storedDeckByName(name)).toEqual([]);
    });

    it('still creates a personal deck when no visibility is sent', async () => {
      const name = `group-required-personal-${copyId}`;
      const { res, body } = await postDeck({ name });

      expect(res.status).toBe(201);
      expect(body.data.visibility).toBe('personal');
      expect(await deckGroupIds(body.data.id)).toEqual([]);
    });

    it('creates a group deck when at least one group is shared', async () => {
      const name = `group-required-shared-${copyId}`;
      const { res, body } = await postDeck({ name, visibility: 'group', groupIds: [groupId] });

      expect(res.status).toBe(201);
      expect(body.data.visibility).toBe('group');
      expect(body.data.groupIds).toEqual([groupId]);
      expect(await deckGroupIds(body.data.id)).toEqual([groupId]);
    });

    it('rejects switching a personal deck to group without a list', async () => {
      const created = await postDeck({ name: `group-required-switch-${copyId}` });
      expect(created.res.status).toBe(201);

      const { res, body } = await putDeck(created.body.data.id, { visibility: 'group' });

      expect(res.status).toBe(422);
      expect(res.headers.get('x-error-code')).toBe('UNPROCESSABLE_ENTITY');
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');

      const stored = await getDeck(created.body.data.id);
      expect(stored.body.data.visibility).toBe('personal');
      expect(await deckGroupIds(created.body.data.id)).toEqual([]);
    });

    it('rejects emptying the groups of a group deck and keeps the link', async () => {
      const created = await postDeck({
        name: `group-required-unshare-${copyId}`,
        visibility: 'group',
        groupIds: [groupId],
      });
      expect(created.res.status).toBe(201);
      const deckId = created.body.data.id as string;

      const { res, body } = await putDeck(deckId, { groupIds: [] });

      expect(res.status).toBe(422);
      expect(res.headers.get('x-error-code')).toBe('UNPROCESSABLE_ENTITY');
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
      expect(await deckGroupIds(deckId)).toEqual([groupId]);

      const stored = await getDeck(deckId);
      expect(stored.res.status).toBe(200);
      expect(stored.body.data.visibility).toBe('group');
      expect(stored.body.data.groupIds).toEqual([groupId]);
    });

    it('keeps the group link on a name-only update (regression)', async () => {
      const created = await postDeck({
        name: `group-required-rename-${copyId}`,
        visibility: 'group',
        groupIds: [groupId],
      });
      expect(created.res.status).toBe(201);
      const deckId = created.body.data.id as string;

      const { res, body } = await putDeck(deckId, { name: `group-required-renamed-${copyId}` });

      expect(res.status).toBe(200);
      expect(body.data.name).toBe(`group-required-renamed-${copyId}`);
      expect(await deckGroupIds(deckId)).toEqual([groupId]);
    });
  });
});
