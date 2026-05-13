import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST, GET } from '@/app/(backend)/api/v1/flashcard-spaces/route';
import {
  GET as getById,
  PUT as update,
  DELETE as deleteFn,
} from '@/app/(backend)/api/v1/flashcard-spaces/[id]/route';
import { TEST_USERS, mockUser, cleanupFlashcardSpaces } from './helpers';
import { createClient } from '@/lib/supabase/server';
import { createNextRequest, createNextRequestWithParams } from './test-utils';

describe('Flashcard Spaces Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupFlashcardSpaces(user.id);
    }
  });

  describe('POST /api/v1/flashcard-spaces', () => {
    it('creates a space and returns 201', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/flashcard-spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Study Space' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Study Space');
    });

    it('returns 422 when name is empty', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/flashcard-spaces', {
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

      const req = createNextRequest('http://localhost/api/v1/flashcard-spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Study Space' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcard-spaces', () => {
    it('lists spaces for user', async () => {
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

  describe('GET /api/v1/flashcard-spaces/:id', () => {
    it('returns space when found and owned by user', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = await createClient();
      const { data: space } = await supabase
        .from('flashcard_spaces')
        .insert({ name: 'Get Me', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcard-spaces/${space.id}`,
        { id: space.id },
      );
      const response = await getById(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.name).toBe('Get Me');
    });

    it('returns 404 for another user space', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = await createClient();
      const { data: space } = await supabase
        .from('flashcard_spaces')
        .insert({ name: 'Teacher Space', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcard-spaces/${space.id}`,
        { id: space.id },
      );
      const response = await getById(request, { params });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/flashcard-spaces/:id', () => {
    it('updates own space and returns 200', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = await createClient();
      const { data: space } = await supabase
        .from('flashcard_spaces')
        .insert({ name: 'Original', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcard-spaces/${space.id}`,
        { id: space.id },
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

    it('returns 403 when updating another user space', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = await createClient();
      const { data: space } = await supabase
        .from('flashcard_spaces')
        .insert({ name: 'Teacher Space', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcard-spaces/${space.id}`,
        { id: space.id },
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

  describe('DELETE /api/v1/flashcard-spaces/:id', () => {
    it('deletes own space and returns 200', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = await createClient();
      const { data: space } = await supabase
        .from('flashcard_spaces')
        .insert({ name: 'To Delete', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcard-spaces/${space.id}`,
        { id: space.id },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 403 when deleting another user space', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = await createClient();
      const { data: space } = await supabase
        .from('flashcard_spaces')
        .insert({ name: 'Teacher Space', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcard-spaces/${space.id}`,
        { id: space.id },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });
});
