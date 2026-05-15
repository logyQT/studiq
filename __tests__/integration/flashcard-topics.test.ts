import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST, GET } from '@/app/(backend)/api/v1/flashcards/topics/route';
import {
  GET as getById,
  PUT as update,
  DELETE as deleteFn,
} from '@/app/(backend)/api/v1/flashcards/topics/[id]/route';
import { TEST_USERS, mockUser, cleanupFlashcardTopics, createServiceClient } from './helpers';
import { createNextRequest, createNextRequestWithParams } from './test-utils';

describe('Flashcard Topics Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupFlashcardTopics(user.id, 'topic-');
    }
  });

  describe('POST /api/v1/flashcards/topics', () => {
    it('creates a topic and returns 201', async () => {
      mockUser(TEST_USERS.TEACHER);

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
      mockUser(TEST_USERS.TEACHER);

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
      mockUser(TEST_USERS.TEACHER);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards/topics/:id', () => {
    it('returns topic when found', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: topic } = await supabase
        .from('flashcard_topics')
        .insert({ name: 'topic-Get Me', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/topics/${topic.id}`,
        { id: topic.id },
      );
      const response = await getById(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.name).toBe('topic-Get Me');
    });

    it('returns 404 when topic does not exist', async () => {
      mockUser(TEST_USERS.TEACHER);

      const fakeId = '00000000-0000-0000-0000-000000000099';
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
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: topic } = await supabase
        .from('flashcard_topics')
        .insert({ name: 'topic-Original', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/topics/${topic.id}`,
        { id: topic.id },
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
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = createServiceClient();
      const { data: topic } = await supabase
        .from('flashcard_topics')
        .insert({ name: 'topic-Teacher Topic', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/topics/${topic.id}`,
        { id: topic.id },
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
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: topic } = await supabase
        .from('flashcard_topics')
        .insert({ name: 'topic-To Delete', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/topics/${topic.id}`,
        { id: topic.id },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 403 when deleting another user topic', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = createServiceClient();
      const { data: topic } = await supabase
        .from('flashcard_topics')
        .insert({ name: 'topic-Teacher Topic', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/topics/${topic.id}`,
        { id: topic.id },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });
});
