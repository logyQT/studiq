import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupFlashcardDecks,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import {
  DELETE as deleteFn,
  GET as getById,
  PUT as update,
} from '@/app/(backend)/api/v1/flashcards/decks/[id]/route';
import { GET, POST } from '@/app/(backend)/api/v1/flashcards/decks/route';

forEachCopy((copyId) => {
  describe(`Flashcard Decks Integration [${copyId}]`, () => {
    registerMock(copyId, null);

    let teacher!: BeforeResult;
    let other!: TestUserFixture;

    beforeAll(async () => {
      // Fresh educator + 5 decks via the real API.
      // Index plan: [0]=GET found, [1]=PUT own, [2]=DELETE own,
      // [3]=GET 404 (another user), [4]=PUT/DELETE 403 (another user)
      // groups[0] = default group (creator is a teacher there),
      // groups[1] = extra group created via the API with no teacher membership.
      // A distinct org name keeps questions.test.ts's `cleanupOrganizationByName`
      // from racing this org away (same reason as flashcard-practice-group-scoping).
      teacher = await before({
        role: 'educator',
        org: `deck-140-org-${copyId}`,
        decks: 5,
        groups: 1,
      });
      other = await createTestUser({ role: 'manager' });
    });

    afterAll(async () => {
      await cleanupFlashcardDecks(teacher.user.id);
      await cleanupFlashcardDecks(other.id);
    });

    beforeEach(() => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
    });

    describe('POST /api/v1/flashcards/decks', () => {
      it('creates a deck and returns 201', async () => {
        mockUser(teacher.user);

        const req = createNextRequest('http://localhost/api/v1/flashcards/decks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'deck-Study Deck' }),
        });

        const response = await POST(req);
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.data.name).toBe('deck-Study Deck');
      });

      it('returns 422 when name is empty', async () => {
        mockUser(teacher.user);

        const req = createNextRequest('http://localhost/api/v1/flashcards/decks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '' }),
        });

        const response = await POST(req);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const req = createNextRequest('http://localhost/api/v1/flashcards/decks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'deck-Study Deck' }),
        });

        const response = await POST(req);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });
    });

    describe('POST /api/v1/flashcards/decks — group sharing authorization (#140)', () => {
      const postDeck = async (body: Record<string, unknown>) => {
        mockUser(teacher.user);
        const req = createNextRequest(
          'http://localhost/api/v1/flashcards/decks',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
          { active_org_id: teacher.orgId! },
        );
        const response = await POST(req);
        return { response, body: await response.json() };
      };

      it('returns 403 and creates no row for a group the caller does not teach', async () => {
        const name = `deck-140-forbidden-${copyId}`;
        const untaughtGroup = teacher.groups[1];

        const { response, body } = await postDeck({
          name,
          visibility: 'group',
          groupIds: [untaughtGroup],
        });

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
        expect(response.headers.get('x-error-code')).toBe('FORBIDDEN');

        const service = createServiceClient();
        const { count } = await service
          .from('flashcard_decks')
          .select('*', { count: 'exact', head: true })
          .eq('name', name);
        expect(count).toBe(0);
      });

      it('returns 201 and persists the group link for a group the caller teaches', async () => {
        const taughtGroup = teacher.groups[0];

        const { response, body } = await postDeck({
          name: `deck-140-allowed-${copyId}`,
          visibility: 'group',
          groupIds: [taughtGroup],
        });

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.data.groupIds).toEqual([taughtGroup]);
      });
    });

    describe('PUT /api/v1/flashcards/decks/:id — group sharing authorization (#140)', () => {
      it('returns 403 and keeps the existing links when adding an untaught group', async () => {
        const taughtGroup = teacher.groups[0];
        const untaughtGroup = teacher.groups[1];

        mockUser(teacher.user);
        const createReq = createNextRequest(
          'http://localhost/api/v1/flashcards/decks',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `deck-140-update-${copyId}`,
              visibility: 'group',
              groupIds: [taughtGroup],
            }),
          },
          { active_org_id: teacher.orgId! },
        );
        const createRes = await POST(createReq);
        const created = await createRes.json();
        expect(createRes.status).toBe(201);
        const deckId = created.data.id as string;

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/flashcards/decks/${deckId}`,
          { id: deckId },
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupIds: [untaughtGroup] }),
          },
          { active_org_id: teacher.orgId! },
        );
        const updateRes = await update(request, { params });
        const updateBody = await updateRes.json();

        expect(updateRes.status).toBe(403);
        expect(updateBody.success).toBe(false);

        const { request: getReq, params: getParams } = createNextRequestWithParams(
          `http://localhost/api/v1/flashcards/decks/${deckId}`,
          { id: deckId },
          undefined,
          { active_org_id: teacher.orgId! },
        );
        const getRes = await getById(getReq, { params: getParams });
        const getBody = await getRes.json();

        expect(getRes.status).toBe(200);
        expect(getBody.data.groupIds).toEqual([taughtGroup]);
      });
    });

    describe('GET /api/v1/flashcards/decks', () => {
      it('lists decks for user', async () => {
        mockUser(teacher.user);

        const req = createNextRequest('http://localhost/api/v1/flashcards/decks');
        const response = await GET(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(Array.isArray(body.data?.items)).toBe(true);
        expect(body.data?.items?.length).toBeGreaterThanOrEqual(5);
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const req = createNextRequest('http://localhost/api/v1/flashcards/decks');
        const response = await GET(req);
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
      });
    });

    describe('GET /api/v1/flashcards/decks/:id', () => {
      it('returns deck when found', async () => {
        mockUser(teacher.user);

        const deckId = teacher.created.decks[0];
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/flashcards/decks/${deckId}`,
          { id: deckId },
        );
        const response = await getById(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.id).toBe(deckId);
        expect(body.data.name).toContain('seed-deck-');
      });

      it('returns 404 for another user deck', async () => {
        mockUser(other);

        const deckId = teacher.created.decks[3];
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/flashcards/decks/${deckId}`,
          { id: deckId },
        );
        const response = await getById(request, { params });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.success).toBe(false);
      });
    });

    describe('PUT /api/v1/flashcards/decks/:id', () => {
      it('updates own deck and returns 200', async () => {
        mockUser(teacher.user);

        const deckId = teacher.created.decks[1];
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/flashcards/decks/${deckId}`,
          { id: deckId },
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Updated' }),
          },
        );
        const response = await update(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.name).toBe('Updated');
      });

      it('returns 403 when updating another user deck', async () => {
        mockUser(other);

        const deckId = teacher.created.decks[0];
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/flashcards/decks/${deckId}`,
          { id: deckId },
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Hacked' }),
          },
        );
        const response = await update(request, { params });
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
      });
    });

    describe('DELETE /api/v1/flashcards/decks/:id', () => {
      it('deletes own deck and returns 200', async () => {
        mockUser(teacher.user);

        const deckId = teacher.created.decks[2];
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/flashcards/decks/${deckId}`,
          { id: deckId },
          { method: 'DELETE' },
        );
        const response = await deleteFn(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
      });

      it('returns 403 when deleting another user deck', async () => {
        mockUser(other);

        const deckId = teacher.created.decks[4];
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/flashcards/decks/${deckId}`,
          { id: deckId },
          { method: 'DELETE' },
        );
        const response = await deleteFn(request, { params });
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.success).toBe(false);
      });
    });
  });
});
