import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST, GET } from '@/app/(backend)/api/v1/flashcards/decks/route';
import {
  GET as getById,
  PUT as update,
  DELETE as deleteFn,
} from '@/app/(backend)/api/v1/flashcards/decks/[id]/route';
import { TEST_USERS, mockUser, cleanupFlashcardDecks, createServiceClient } from './helpers';
import { createNextRequest, createNextRequestWithParams } from './test-utils';

describe('Flashcard Decks Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupFlashcardDecks(user.id, 'deck-');
    }
  });

  describe('POST /api/v1/flashcards/decks', () => {
    it('creates a deck and returns 201', async () => {
      mockUser(TEST_USERS.TEACHER);

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
      mockUser(TEST_USERS.TEACHER);

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

  describe('GET /api/v1/flashcards/decks/:id', () => {
    it('returns deck when found and owned by user', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: deck } = await supabase
        .from('flashcard_decks')
        .insert({ name: 'deck-Get Me', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deck.id}`,
        { id: deck.id },
      );
      const response = await getById(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.name).toBe('deck-Get Me');
    });

    it('returns 404 for another user deck', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = createServiceClient();
      const { data: deck } = await supabase
        .from('flashcard_decks')
        .insert({ name: 'deck-Teacher Deck', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deck.id}`,
        { id: deck.id },
      );
      const response = await getById(request, { params });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/flashcards/decks/:id', () => {
    it('updates own deck and returns 200', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: deck, error: insertError } = await supabase
        .from('flashcard_decks')
        .insert({ name: 'deck-Original', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();
      if (insertError || !deck) throw new Error(`Failed to create deck: ${insertError?.message}`);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deck.id}`,
        { id: deck.id },
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
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = createServiceClient();
      const { data: deck } = await supabase
        .from('flashcard_decks')
        .insert({ name: 'deck-Teacher Deck', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deck.id}`,
        { id: deck.id },
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
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: deck, error: insertError } = await supabase
        .from('flashcard_decks')
        .insert({ name: 'deck-To Delete', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();
      if (insertError || !deck) throw new Error(`Failed to create deck: ${insertError?.message}`);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deck.id}`,
        { id: deck.id },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 403 when deleting another user deck', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = createServiceClient();
      const { data: deck } = await supabase
        .from('flashcard_decks')
        .insert({ name: 'deck-Teacher Deck', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/decks/${deck.id}`,
        { id: deck.id },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });
});
