import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELETE as deleteFn,
  GET as getById,
  PUT as update,
} from '@/app/(backend)/api/v1/flashcards/decks/[id]/route';
import { GET, POST } from '@/app/(backend)/api/v1/flashcards/decks/route';
import {
  before,
  createTestUser,
  type BeforeResult,
  type TestUserFixture,
} from '#test/helpers/test-user';
import { cleanupFlashcardDecks, mockUser } from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';

describe('Flashcard Decks Integration', () => {
  let teacher!: BeforeResult;
  let other!: TestUserFixture;

  beforeAll(async () => {
    // Fresh educator + 5 decks via the real API.
    // Index plan: [0]=GET found, [1]=PUT own, [2]=DELETE own,
    // [3]=GET 404 (another user), [4]=PUT/DELETE 403 (another user)
    teacher = await before({ role: 'educator', decks: 5 });
    other = await createTestUser({ role: 'manager' });
  });

  afterAll(async () => {
    await cleanupFlashcardDecks(teacher.user.id);
    await cleanupFlashcardDecks(other.id);
  });

  beforeEach(() => {
    vi.clearAllMocks();
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