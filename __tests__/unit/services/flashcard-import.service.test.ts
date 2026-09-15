import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { FlashcardImportService } from '@/server/services/flashcard-import.service';
import type { RequestContext } from '@/lib/request-context';

vi.mock('@/lib/authz', () => ({
  check: vi.fn().mockResolvedValue(undefined),
  Permission: { DECK_UPDATE: 'deck.update' },
}));

function qb(data: any, error: any = null) {
  const promise = Promise.resolve({ data: data ?? null, error });
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.maybeSingle = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('FlashcardImportService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: FlashcardImportService;
  const ctx: RequestContext = {
    userId: 'user-1',
    accountType: 'student' as any,
    traceId: 'test',
    url: '',
    method: 'POST',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new FlashcardImportService(async () => mock as any);
  });

  describe('importCsv', () => {
    it('imports cards with deckId', async () => {
      const deck = { id: 'deck-1', name: 'Test Deck' };
      const flashcards = [{ id: 'fc-1' }, { id: 'fc-2' }];
      // Service calls: 1) deck lookup  2) insert flashcards
      mock.from.mockReturnValueOnce(qb(deck)); // fetch deck
      mock.from.mockReturnValueOnce(qb(flashcards)); // insert flashcards

      const result = await service.importCsv(
        {
          deckId: 'deck-1',
          cards: [
            { front: 'Hello', back: 'Cześć' },
            { front: 'Thanks', back: 'Dzięki' },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data.imported).toBe(2);
    });

    it('returns NOT_FOUND for invalid deckId', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.importCsv(
        { deckId: 'nonexistent', cards: [{ front: 'H', back: 'C' }] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('creates default deck when no deckId', async () => {
      const newDeck = { id: 'deck-new' };
      const flashcards = [{ id: 'fc-1' }];
      // Service calls: 1) create default deck  2) insert flashcards
      mock.from.mockReturnValueOnce(qb(newDeck)); // insert default deck
      mock.from.mockReturnValueOnce(qb(flashcards)); // insert flashcards

      const result = await service.importCsv(
        { cards: [{ front: 'Hello', back: 'Cześć' }] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data.imported).toBe(1);
    });

    it('handles cards with topics', async () => {
      const newDeck = { id: 'deck-new' };
      const existingTopics = [{ id: 't-1', name: 'Greeting' }];
      const flashcards = [{ id: 'fc-1' }];
      // Service calls: 1) create default deck  2) find existing topics
      //   3) insert flashcards  4) insert topic assignments
      mock.from.mockReturnValueOnce(qb(newDeck));
      mock.from.mockReturnValueOnce(qb(existingTopics));
      mock.from.mockReturnValueOnce(qb(flashcards));
      mock.from.mockReturnValueOnce(qb(undefined)); // topic assignments

      const result = await service.importCsv(
        { cards: [{ front: 'Hello', back: 'Cześć', topic: 'Greeting' }] },
        ctx,
      );

      expect(result.success).toBe(true);
    });

    it('creates new topics', async () => {
      const newDeck = { id: 'deck-new' };
      const newTopics = [{ id: 't-new', name: 'NewTopic' }];
      const flashcards = [{ id: 'fc-1' }];
      // Service calls: 1) create default deck  2) find existing topics (none)
      //   3) create new topics  4) insert flashcards  5) insert topic assignments
      mock.from.mockReturnValueOnce(qb(newDeck));
      mock.from.mockReturnValueOnce(qb([])); // existing topics
      mock.from.mockReturnValueOnce(qb(newTopics)); // new topics
      mock.from.mockReturnValueOnce(qb(flashcards)); // insert flashcards
      mock.from.mockReturnValueOnce(qb(undefined)); // topic assignments

      const result = await service.importCsv(
        { cards: [{ front: 'Hello', back: 'Cześć', topic: 'NewTopic' }] },
        ctx,
      );

      expect(result.success).toBe(true);
    });

    it('handles cards with deck names', async () => {
      const existingDecks = [{ id: 'd-1', name: 'MyDeck' }];
      const flashcards = [{ id: 'fc-1' }];
      // hasDeckColumn=true → no default deck creation
      // Service calls: 1) find existing decks  2) insert flashcards
      mock.from.mockReturnValueOnce(qb(existingDecks)); // existing decks
      mock.from.mockReturnValueOnce(qb(flashcards)); // insert flashcards

      const result = await service.importCsv(
        { cards: [{ front: 'Hello', back: 'Cześć', deck: 'MyDeck' }] },
        ctx,
      );

      expect(result.success).toBe(true);
    });

    it('returns error on flashcard insert failure', async () => {
      const newDeck = { id: 'deck-new' };
      // Service calls: 1) create default deck  2) insert flashcards (fails)
      mock.from.mockReturnValueOnce(qb(newDeck));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.importCsv(
        { cards: [{ front: 'Hello', back: 'Cześć' }] },
        ctx,
      );

      expect(result.success).toBe(false);
    });
  });
});
