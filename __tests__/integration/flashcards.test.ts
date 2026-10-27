import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  useRealSupabase,
  cleanupFlashcardDecks,
  cleanupFlashcards,
  cleanupFlashcardTopics,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import {
  DELETE as deleteFn,
  GET as getById,
  PUT as update,
} from '@/app/(backend)/api/v1/flashcards/[id]/route';
import { POST as batchAction } from '@/app/(backend)/api/v1/flashcards/batch/[action]/route';
import { GET, POST } from '@/app/(backend)/api/v1/flashcards/route';

const suiteId = crypto.randomUUID().slice(0, 8);

describe(`Flashcards Integration`, () => {
  let teacher!: BeforeResult;
  let student!: TestUserFixture;
  let other!: TestUserFixture;
  let topicId!: string;
  let deckId!: string;

  beforeAll(async () => {
    // Fresh educator + topic/deck/flashcards via the real API (seedViaApi).
    teacher = await before({ role: 'educator', topics: 1, decks: 1, flashcards: 6 });
    topicId = teacher.created.topics[0];
    deckId = teacher.created.decks[0];
    // Student visibility check + manager for 403 checks.
    student = await createTestUser({ role: 'student' });
    other = await createTestUser({ role: 'manager' });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    useRealSupabase();
    // Clear test-created content from the previous test (seed content uses
    // 'seed-' prefixes and is preserved; cleaned up in afterAll).
    for (const user of [teacher.user, student, other]) {
      await cleanupFlashcards(user.id, 'fc-');
      await cleanupFlashcardTopics(user.id, 'topic-');
      await cleanupFlashcardDecks(user.id, 'deck-');
    }
  });

  afterAll(async () => {
    for (const user of [teacher.user, student, other]) {
      await cleanupFlashcards(user.id);
      await cleanupFlashcardTopics(user.id);
      await cleanupFlashcardDecks(user.id);
    }
  });

  describe('POST /api/v1/flashcards', () => {
    it('creates a flashcard and returns 201', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front: `fc-${suiteId}-What is 2+2?`, back: '4', deckId }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.front).toBe(`fc-${suiteId}-What is 2+2?`);
    });

    it('creates a flashcard with topicIds', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          front: `fc-${suiteId}-Topic Card`,
          back: 'Answer',
          topicIds: [topicId],
          deckId,
        }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('creates a flashcard with deckId', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front: `fc-${suiteId}-Deck Card`, back: 'Answer', deckId }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('returns 422 when front is empty', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front: '', back: 'Answer', deckId }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front: 'Q', back: 'A', deckId }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards', () => {
    it('returns flashcards list for authenticated user', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data?.items)).toBe(true);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/flashcards');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('filters by topicIds', async () => {
      mockUser(teacher.user);

      await POST(
        createNextRequest('http://localhost/api/v1/flashcards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            front: `fc-${suiteId}-Filtered Card`,
            back: 'Answer',
            topicIds: [topicId],
            deckId,
          }),
        }),
      );

      const req = createNextRequest(`http://localhost/api/v1/flashcards?topicIds=${topicId}`);
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data?.items?.length).toBe(1);
      expect(body.data?.items?.[0]?.front).toBe(`fc-${suiteId}-Filtered Card`);
    });

    it('returns only own flashcards for student', async () => {
      mockUser(student);

      const req = createNextRequest('http://localhost/api/v1/flashcards');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data?.items).toEqual([]);
    });

    it('returns flashcards list for student', async () => {
      mockUser(student);

      const req = createNextRequest('http://localhost/api/v1/flashcards');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data?.items)).toBe(true);
    });
  });

  describe('POST /api/v1/flashcards/batch/create', () => {
    it('bulk creates flashcards and returns 201', async () => {
      mockUser(teacher.user);

      const { request, params } = createNextRequestWithParams(
        'http://localhost/api/v1/flashcards/batch/create',
        { action: 'create' },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckId: deckId,
            cards: [
              { front: `fc-${suiteId}-Q1`, back: 'A1' },
              { front: `fc-${suiteId}-Q2`, back: 'A2' },
            ],
          }),
        },
      );
      const response = await batchAction(request, { params });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(2);
    });

    // Regression for #386: the AI chat sent `deckIds`, which Zod stripped, so
    // the cards were inserted without a deck and the request failed with 400.
    it('links bulk-created cards to the given deck', async () => {
      mockUser(teacher.user);
      const front = `fc-${suiteId}-linked-to-deck`;

      const { request, params } = createNextRequestWithParams(
        'http://localhost/api/v1/flashcards/batch/create',
        { action: 'create' },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckId,
            cards: [{ front, back: 'A1' }],
          }),
        },
      );
      const response = await batchAction(request, { params });
      expect(response.status).toBe(201);

      const listRequest = createNextRequest(`http://localhost/api/v1/flashcards?deckIds=${deckId}`);
      const listResponse = await GET(listRequest);
      const listBody = await listResponse.json();
      const fronts = (listBody.data?.items as Array<{ front: string }>).map((fc) => fc.front);

      expect(listResponse.status).toBe(200);
      expect(fronts).toContain(front);
    });

    it('returns 422 when cards array is empty', async () => {
      mockUser(teacher.user);

      const { request, params } = createNextRequestWithParams(
        'http://localhost/api/v1/flashcards/batch/create',
        { action: 'create' },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cards: [] }),
        },
      );
      const response = await batchAction(request, { params });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });
  });

  describe('POST /api/v1/flashcards/batch/delete', () => {
    async function createCards(count: number) {
      mockUser(teacher.user);
      const { request, params } = createNextRequestWithParams(
        'http://localhost/api/v1/flashcards/batch/create',
        { action: 'create' },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckId,
            cards: Array.from({ length: count }, (_, i) => ({
              front: `fc-${suiteId}-delete-${i}`,
              back: `A${i}`,
            })),
          }),
        },
      );
      const response = await batchAction(request, { params });
      const body = await response.json();
      return (body.data as Array<{ id: string }>).map((fc) => fc.id);
    }

    function batchDeleteRequest(ids: string[]) {
      return createNextRequestWithParams(
        'http://localhost/api/v1/flashcards/batch/delete',
        { action: 'delete' },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        },
      );
    }

    it('deletes own cards and returns 200', async () => {
      const ids = await createCards(2);
      mockUser(teacher.user);

      const { request, params } = batchDeleteRequest(ids);
      const response = await batchAction(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ deleted: 2 });

      // The cards no longer exist.
      const { request: getRequest, params: getParams } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${ids[0]}`,
        { id: ids[0] },
      );
      const getResponse = await getById(getRequest, { params: getParams });
      expect(getResponse.status).toBe(404);
    });

    it('returns 403 when deleting another user cards and keeps them', async () => {
      const ids = await createCards(1);
      mockUser(other);

      const { request, params } = batchDeleteRequest(ids);
      const response = await batchAction(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);

      // Still present for the owner.
      mockUser(teacher.user);
      const { request: getRequest, params: getParams } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${ids[0]}`,
        { id: ids[0] },
      );
      const getResponse = await getById(getRequest, { params: getParams });
      expect(getResponse.status).toBe(200);
    });
  });

  describe('GET /api/v1/flashcards/:id', () => {
    it('returns flashcard when found', async () => {
      mockUser(teacher.user);

      const flashcardId = teacher.created.flashcards[4];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}`,
        { id: flashcardId },
      );
      const response = await getById(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(flashcardId);
      expect(body.data.front).toContain('seed-flashcard-front-');
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const { request, params } = createNextRequestWithParams(
        'http://localhost/api/v1/flashcards/some-id',
        { id: 'some-id' },
      );
      const response = await getById(request, { params });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/flashcards/:id', () => {
    it('updates own flashcard and returns 200', async () => {
      mockUser(teacher.user);

      const flashcardId = teacher.created.flashcards[0];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}`,
        { id: flashcardId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ front: 'Updated' }),
        },
      );
      const response = await update(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.front).toBe('Updated');
    });

    it('returns 403 when updating another user flashcard', async () => {
      mockUser(other);

      const flashcardId = teacher.created.flashcards[1];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}`,
        { id: flashcardId },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ front: 'Hacked' }),
        },
      );
      const response = await update(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/flashcards/:id', () => {
    it('deletes own flashcard and returns 200', async () => {
      mockUser(teacher.user);

      const flashcardId = teacher.created.flashcards[2];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}`,
        { id: flashcardId },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 403 when deleting another user flashcard', async () => {
      mockUser(other);

      const flashcardId = teacher.created.flashcards[3];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}`,
        { id: flashcardId },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });
});
