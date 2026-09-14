import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELETE as deleteFn,
  GET as getById,
  PUT as update,
} from '@/app/(backend)/api/v1/flashcards/[id]/route';
import { POST as bulkCreate } from '@/app/(backend)/api/v1/flashcards/batch/[action]/route';
import { GET, POST } from '@/app/(backend)/api/v1/flashcards/route';
import {
  cleanupFlashcardDecks,
  cleanupFlashcards,
  cleanupFlashcardTopics,
  createServiceClient,
  mockUser,
  TEST_USERS,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';

describe('Flashcards Integration', () => {
  let topicId: string;
  let deckId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const supabase = createServiceClient();

    const { data: topic } = await supabase
      .from('topics')
      .insert({ name: 'fc-topic-Flashcard Topic', created_by: TEST_USERS.TEACHER.id })
      .select()
      .single();
    if (!topic) throw new Error('Failed to create topic');
    topicId = topic.id;

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .insert({ name: 'fc-deck-Test Deck', created_by: TEST_USERS.TEACHER.id })
      .select()
      .single();
    if (!deck) throw new Error('Failed to create deck');
    deckId = deck.id;
  });

  afterEach(async () => {
    for (const user of Object.values(TEST_USERS)) {
      await cleanupFlashcards(user.id, 'fc-');
      await cleanupFlashcardTopics(user.id, 'fc-');
      await cleanupFlashcardDecks(user.id, 'fc-');
    }
  });

  describe('POST /api/v1/flashcards', () => {
    it('creates a flashcard and returns 201', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front: 'fc-What is 2+2?', back: '4', deckId }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.front).toBe('fc-What is 2+2?');
    });

    it('creates a flashcard with topicIds', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front: 'fc-Topic Card', back: 'Answer', topicIds: [topicId], deckId }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('creates a flashcard with deckId', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front: 'fc-Deck Card', back: 'Answer', deckId }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('returns 422 when front is empty', async () => {
      mockUser(TEST_USERS.TEACHER);

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
      mockUser(TEST_USERS.TEACHER);

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
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: fc } = await supabase
        .from('flashcards')
        .insert({
          front: 'fc-Filtered Card',
          back: 'Answer',
          created_by: TEST_USERS.TEACHER.id,
          deck_id: deckId,
        })
        .select()
        .single();

      await supabase.from('flashcard_topic_assignments').insert({
        flashcard_id: fc.id,
        topic_id: topicId,
      });

      const req = createNextRequest(`http://localhost/api/v1/flashcards?topicIds=${topicId}`);
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data?.items?.length).toBe(1);
      expect(body.data?.items?.[0]?.front).toBe('fc-Filtered Card');
    });

    it('returns only own flashcards for student', async () => {
      mockUser(TEST_USERS.STUDENT);

      const supabase = createServiceClient();
      await supabase
        .from('flashcards')
        .insert({
          front: 'fc-Teacher Org Card',
          back: 'Answer',
          created_by: TEST_USERS.TEACHER.id,
          deck_id: deckId,
        })
        .select();

      const req = createNextRequest('http://localhost/api/v1/flashcards');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data?.items).toEqual([]);
    });

    it('returns flashcards list for student', async () => {
      mockUser(TEST_USERS.STUDENT);

      const req = createNextRequest('http://localhost/api/v1/flashcards');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data?.items)).toBe(true);
    });
  });

  describe('PUT /api/v1/flashcards (bulk create)', () => {
    it('bulk creates flashcards and returns 201', async () => {
      mockUser(TEST_USERS.TEACHER);

      const { request, params } = createNextRequestWithParams(
        'http://localhost/api/v1/flashcards/batch/create',
        { action: 'create' },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckId: deckId,
            cards: [
              { front: 'Q1', back: 'A1' },
              { front: 'Q2', back: 'A2' },
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
      mockUser(TEST_USERS.TEACHER);

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
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: fc } = await supabase
        .from('flashcards')
        .insert({
          front: 'fc-Get Me',
          back: 'Answer',
          created_by: TEST_USERS.TEACHER.id,
          deck_id: deckId,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${fc.id}`,
        { id: fc.id },
      );
      const response = await getById(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.front).toBe('fc-Get Me');
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
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: fc } = await supabase
        .from('flashcards')
        .insert({
          front: 'fc-Original',
          back: 'Answer',
          created_by: TEST_USERS.TEACHER.id,
          deck_id: deckId,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${fc.id}`,
        { id: fc.id },
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
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = createServiceClient();
      const { data: fc } = await supabase
        .from('flashcards')
        .insert({
          front: 'fc-Teacher Card',
          back: 'Answer',
          created_by: TEST_USERS.TEACHER.id,
          deck_id: deckId,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${fc.id}`,
        { id: fc.id },
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
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: fc } = await supabase
        .from('flashcards')
        .insert({
          front: 'fc-To Delete',
          back: 'Answer',
          created_by: TEST_USERS.TEACHER.id,
          deck_id: deckId,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${fc.id}`,
        { id: fc.id },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 403 when deleting another user flashcard', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = createServiceClient();
      const { data: fc } = await supabase
        .from('flashcards')
        .insert({
          front: 'fc-Teacher Card',
          back: 'Answer',
          created_by: TEST_USERS.TEACHER.id,
          deck_id: deckId,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${fc.id}`,
        { id: fc.id },
        { method: 'DELETE' },
      );
      const response = await deleteFn(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });
});
