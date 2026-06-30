import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELETE as deleteFn,
  GET as getById,
  PUT as update,
} from '@/app/(backend)/api/v1/flashcards/[id]/route';
import { PUT as bulkPut, GET, POST } from '@/app/(backend)/api/v1/flashcards/route';
import {
  cleanupFlashcardDecks,
  cleanupFlashcards,
  cleanupFlashcardTopics,
  createServiceClient,
  mockUser,
  TEST_ORGANIZATION_ID,
  TEST_USERS,
} from './helpers';
import { createNextRequest, createNextRequestWithParams } from './test-utils';

describe('Flashcards Integration', () => {
  let topicId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupFlashcards(user.id, 'fc-');
      await cleanupFlashcardTopics(user.id, 'fc-topic-');
      await cleanupFlashcardDecks(user.id, 'fc-deck-');
    }

    const supabase = createServiceClient();
    const { data: topic } = await supabase
      .from('flashcard_topics')
      .insert({
        name: 'fc-topic-Flashcard Topic',
        created_by: TEST_USERS.TEACHER.id,
        organization_id: TEST_ORGANIZATION_ID,
      })
      .select()
      .single();
    topicId = topic.id;
  });

  describe('POST /api/v1/flashcards', () => {
    it('creates a flashcard and returns 201', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front: 'fc-What is 2+2?', back: '4' }),
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
        body: JSON.stringify({ front: 'fc-Topic Card', back: 'Answer', topicIds: [topicId] }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('creates a flashcard with deckIds', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: deck } = await supabase
        .from('flashcard_decks')
        .insert({ name: 'deck-Test', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      const req = createNextRequest('http://localhost/api/v1/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          front: 'fc-Deck Card',
          back: 'Answer',
          deckIds: [deck.id],
        }),
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
        body: JSON.stringify({ front: '', back: 'Answer' }),
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
        body: JSON.stringify({ front: 'Q', back: 'A' }),
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
      expect(Array.isArray(body.data)).toBe(true);
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
          organization_id: TEST_ORGANIZATION_ID,
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
      expect(body.data.length).toBe(1);
      expect(body.data[0].front).toBe('fc-Filtered Card');
    });

    it('returns only own flashcards for free user', async () => {
      mockUser(TEST_USERS.FREE);

      const supabase = createServiceClient();
      await supabase
        .from('flashcards')
        .insert({
          front: 'fc-Teacher Org Card',
          back: 'Answer',
          created_by: TEST_USERS.TEACHER.id,
          organization_id: TEST_ORGANIZATION_ID,
        })
        .select();

      const req = createNextRequest('http://localhost/api/v1/flashcards');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual([]);
    });

    it('returns org flashcards for student in same organization', async () => {
      mockUser(TEST_USERS.STUDENT);

      const supabase = createServiceClient();
      const { data: fc } = await supabase
        .from('flashcards')
        .insert({
          front: 'fc-Teacher Org Card',
          back: 'Answer',
          created_by: TEST_USERS.TEACHER.id,
          organization_id: TEST_ORGANIZATION_ID,
        })
        .select()
        .single();

      const req = createNextRequest('http://localhost/api/v1/flashcards');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      const found = body.data.find((f: any) => f.id === fc.id);
      expect(found).toBeDefined();
      expect(found.front).toBe('fc-Teacher Org Card');
    });
  });

  describe('PUT /api/v1/flashcards (bulk create)', () => {
    it('bulk creates flashcards and returns 201', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/flashcards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards: [
            { front: 'Q1', back: 'A1' },
            { front: 'Q2', back: 'A2' },
          ],
        }),
      });

      const response = await bulkPut(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(2);
    });

    it('returns 422 when cards array is empty', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/flashcards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: [] }),
      });

      const response = await bulkPut(req);
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
          organization_id: TEST_ORGANIZATION_ID,
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
          organization_id: TEST_ORGANIZATION_ID,
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
          organization_id: TEST_ORGANIZATION_ID,
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
          organization_id: TEST_ORGANIZATION_ID,
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
          organization_id: TEST_ORGANIZATION_ID,
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
