import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST, GET } from '@/app/(backend)/api/v1/flashcard-practice/route';
import { TEST_USERS, mockUser, cleanupFlashcardPractice, cleanupFlashcards } from './helpers';
import { createClient } from '@/lib/supabase/server';

describe('Flashcard Practice Integration', () => {
  let flashcardId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupFlashcardPractice(user.id);
      await cleanupFlashcards(user.id);
    }

    const supabase = await createClient();
    const { data: fc } = await supabase
      .from('flashcards')
      .insert({ front: 'Practice Card', back: 'Answer', created_by: TEST_USERS.TEACHER.id })
      .select()
      .single();
    flashcardId = fc.id;
  });

  describe('POST /api/v1/flashcard-practice', () => {
    it('logs practice and returns 201', async () => {
      mockUser(TEST_USERS.STUDENT);

      const req = new Request('http://localhost/api/v1/flashcard-practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flashcardId, wasCorrect: true }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('returns 422 when flashcardId is invalid', async () => {
      mockUser(TEST_USERS.STUDENT);

      const req = new Request('http://localhost/api/v1/flashcard-practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flashcardId: 'not-a-uuid', wasCorrect: true }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = new Request('http://localhost/api/v1/flashcard-practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flashcardId, wasCorrect: true }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcard-practice', () => {
    it('returns practice history for user', async () => {
      mockUser(TEST_USERS.STUDENT);

      const req = new Request('http://localhost/api/v1/flashcard-practice');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns empty array when no practice exists', async () => {
      mockUser(TEST_USERS.PREMIUM);

      const req = new Request('http://localhost/api/v1/flashcard-practice');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual([]);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = new Request('http://localhost/api/v1/flashcard-practice');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });
});
