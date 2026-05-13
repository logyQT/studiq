import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST, GET } from '@/app/(backend)/api/v1/flashcard-topics/route';
import { GET as getById, PUT as update, DELETE as deleteFn } from '@/app/(backend)/api/v1/flashcard-topics/[id]/route';
import { TEST_USERS, mockUser, cleanupFlashcardTopics } from './helpers';
import { createClient } from '@/lib/supabase/server';

describe('Flashcard Topics Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupFlashcardTopics(user.id);
    }
  });

  describe('POST /api/v1/flashcard-topics', () => {
    it('creates a topic and returns 201', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = new Request('http://localhost/api/v1/flashcard-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Math Topics' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Math Topics');
    });

    it('returns 422 when name is empty', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = new Request('http://localhost/api/v1/flashcard-topics', {
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

      const req = new Request('http://localhost/api/v1/flashcard-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Math Topics' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcard-topics', () => {
    it('lists topics for user', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = new Request('http://localhost/api/v1/flashcard-topics');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = new Request('http://localhost/api/v1/flashcard-topics');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcard-topics/:id', () => {
    it('returns topic when found', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = await createClient();
      const { data: topic } = await supabase
        .from('flashcard_topics')
        .insert({ name: 'Get Me', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const req = new Request(`http://localhost/api/v1/flashcard-topics/${topic.id}`);
      const response = await getById(req, { params: Promise.resolve({ id: topic.id }) });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.name).toBe('Get Me');
    });

    it('returns 404 when topic does not exist', async () => {
      mockUser(TEST_USERS.TEACHER);

      const fakeId = '00000000-0000-0000-0000-000000000099';
      const req = new Request(`http://localhost/api/v1/flashcard-topics/${fakeId}`);
      const response = await getById(req, { params: Promise.resolve({ id: fakeId }) });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/flashcard-topics/:id', () => {
    it('updates own topic and returns 200', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = await createClient();
      const { data: topic } = await supabase
        .from('flashcard_topics')
        .insert({ name: 'Original', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const req = new Request(`http://localhost/api/v1/flashcard-topics/${topic.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      const response = await update(req, { params: Promise.resolve({ id: topic.id }) });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.name).toBe('Updated');
    });

    it('returns 403 when updating another user topic', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = await createClient();
      const { data: topic } = await supabase
        .from('flashcard_topics')
        .insert({ name: 'Teacher Topic', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const req = new Request(`http://localhost/api/v1/flashcard-topics/${topic.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hacked' }),
      });

      const response = await update(req, { params: Promise.resolve({ id: topic.id }) });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/flashcard-topics/:id', () => {
    it('deletes own topic and returns 200', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = await createClient();
      const { data: topic } = await supabase
        .from('flashcard_topics')
        .insert({ name: 'To Delete', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const req = new Request(`http://localhost/api/v1/flashcard-topics/${topic.id}`, {
        method: 'DELETE',
      });

      const response = await deleteFn(req, { params: Promise.resolve({ id: topic.id }) });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 403 when deleting another user topic', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = await createClient();
      const { data: topic } = await supabase
        .from('flashcard_topics')
        .insert({ name: 'Teacher Topic', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const req = new Request(`http://localhost/api/v1/flashcard-topics/${topic.id}`, {
        method: 'DELETE',
      });

      const response = await deleteFn(req, { params: Promise.resolve({ id: topic.id }) });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });
});
