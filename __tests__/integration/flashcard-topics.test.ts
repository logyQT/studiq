import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELETE as deleteFn,
  GET as getById,
  PUT as update,
} from '@/app/(backend)/api/v1/flashcards/topics/[id]/route';
import { GET, POST } from '@/app/(backend)/api/v1/flashcards/topics/route';
import {
  before,
  createTestUser,
  type BeforeResult,
  type TestUserFixture,
} from '#test/helpers/test-user';
import { cleanupFlashcardTopics, mockUser } from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';

describe('Flashcard Topics Integration', () => {
  let teacher!: BeforeResult;
  let other!: TestUserFixture;

  beforeAll(async () => {
    // Fresh educator + 4 topics created through the real API (seedViaApi).
    teacher = await before({ role: 'educator', topics: 4 });
    // Manager user (non-owner) for 403 checks — matches legacy UNIVERSITY_ADMIN semantics.
    other = await createTestUser({ role: 'manager' });
  });

  afterAll(async () => {
    await cleanupFlashcardTopics(teacher.user.id);
    await cleanupFlashcardTopics(other.id);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/flashcards/topics', () => {
    it('creates a topic and returns 201', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'topic-Math Topics' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('topic-Math Topics');
    });

    it('returns 422 when name is empty', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards/topics', {
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

      const req = createNextRequest('http://localhost/api/v1/flashcards/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'topic-Math Topics' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards/topics', () => {
    it('lists topics for user', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards/topics');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data?.items)).toBe(true);
      expect(body.data?.items?.length).toBeGreaterThanOrEqual(4);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/flashcards/topics');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards/topics/:id', () => {
    it('returns topic when found', async () => {
      mockUser(teacher.user);

      const topicId = teacher.created.topics[0];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/topics/${topicId}`,
        { id: topicId },
      );
      const response = await getById(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.id).toBe(topicId);
      expect(body.data.name).toContain('seed-topic-');
    });

    it('returns 404 when topic does not exist', async () => {
      mockUser(teacher.user);

      const fakeId = '00000000-0000-4000-8000-000000000099';
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/topics/${fakeId}`,
        { id: fakeId },
      );
      const response = await getById(request, { params });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/flashcards/topics/:id', () => {
    it('updates own topic and returns 200', async () => {
      mockUser(teacher.user);

      const topicId = teacher.created.topics[1];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/topics/${topicId}`,
        { id: topicId },
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

    it('returns 403 when updating another user topic', async () => {
      mockUser(other);

      const topicId = teacher.created.topics[0];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/topics/${topicId}`,
        { id: topicId },
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

  describe('DELETE /api/v1/flashcards/topics/:id', () => {
    it('deletes own topic and returns 200', async () => {
      mockUser(teacher.user);

      const topicId = teacher.created.topics[2];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/topics/${topicId}`,
        { id: topicId },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 403 when deleting another user topic', async () => {
      mockUser(other);

      const topicId = teacher.created.topics[3];
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/topics/${topicId}`,
        { id: topicId },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });
});