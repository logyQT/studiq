import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  DELETE as deleteFn,
  GET as getById,
  PUT as update,
} from '@/app/(backend)/api/v1/flashcards/[id]/route';
import { POST as bulkCreate } from '@/app/(backend)/api/v1/flashcards/batch/[action]/route';
import { GET, POST } from '@/app/(backend)/api/v1/flashcards/route';
import {
  applyRegisteredMock,
  cleanupFlashcardDecks,
  cleanupFlashcards,
  cleanupFlashcardTopics,
  mockUser,
} from '#test/integration/helpers';
import {
  before,
  createTestUser,
  type BeforeResult,
  type TestUserFixture,
} from '#test/helpers/test-user';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';

forEachCopy((copyId) => {
  describe(`Flashcards Integration [${copyId}]`, () => {
    registerMock(copyId, null);

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
      applyRegisteredMock(copyId);
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
          body: JSON.stringify({ front: `fc-${copyId}-What is 2+2?`, back: '4', deckId }),
        });

        const response = await POST(req);
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.data.front).toBe(`fc-${copyId}-What is 2+2?`);
      });

      it('creates a flashcard with topicIds', async () => {
        mockUser(teacher.user);

        const req = createNextRequest('http://localhost/api/v1/flashcards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ front: `fc-${copyId}-Topic Card`, back: 'Answer', topicIds: [topicId], deckId }),
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
          body: JSON.stringify({ front: `fc-${copyId}-Deck Card`, back: 'Answer', deckId }),
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
            body: JSON.stringify({ front: `fc-${copyId}-Filtered Card`, back: 'Answer', topicIds: [topicId], deckId }),
          }),
        );

        const req = createNextRequest(`http://localhost/api/v1/flashcards?topicIds=${topicId}`);
        const response = await GET(req);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data?.items?.length).toBe(1);
        expect(body.data?.items?.[0]?.front).toBe(`fc-${copyId}-Filtered Card`);
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
                { front: `fc-${copyId}-Q1`, back: 'A1' },
                { front: `fc-${copyId}-Q2`, back: 'A2' },
              ],
            }),
          },
        );
        const response = await bulkCreate(request, { params });
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.data.length).toBe(2);
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
        const response = await bulkCreate(request, { params });
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
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
});
