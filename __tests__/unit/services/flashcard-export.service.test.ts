import { AccountType, type RequestContext } from '@studiq/authz';
import { flashcardService } from '@studiq/server/services/flashcard.service';
import { FlashcardExportService } from '@studiq/server/services/flashcard-export.service';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('@studiq/server/services/flashcard.service', () => ({
  flashcardService: {
    list: vi.fn(),
  },
}));

type DbError = { message?: string; code?: string };
type QueryResult<T> = { data: T | null; error: DbError | null };

interface FakeQueryBuilder<T> {
  select: Mock;
  in: Mock;
  then: Promise<QueryResult<T>>['then'];
  catch: Promise<QueryResult<T>>['catch'];
  finally: Promise<QueryResult<T>>['finally'];
}

function qb<T>(data: T, error: DbError | null = null): FakeQueryBuilder<T> {
  const result: QueryResult<T> = { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: FakeQueryBuilder<T> = {
    select: vi.fn(),
    in: vi.fn(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  b.select.mockImplementation(() => b);
  b.in.mockImplementation(() => b);
  return b;
}

describe('FlashcardExportService', () => {
  let service: FlashcardExportService;
  let mockCreateClient: Mock;
  const ctx: RequestContext = {
    userId: 'user-1',
    accountType: AccountType.STUDENT,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient = vi.fn();
    service = new FlashcardExportService(mockCreateClient);
  });

  describe('exportCsv', () => {
    it('exports empty when no flashcards', async () => {
      vi.mocked(flashcardService.list).mockResolvedValueOnce({
        success: true,
        data: { items: [], hasMore: false, nextCursor: null },
      });

      const result = await service.exportCsv(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toContain('front,back,topic,deck');
    });

    it('exports flashcards with topics and decks', async () => {
      const flashcards = [
        {
          id: 'fc-1',
          front: 'Hello',
          back: 'Cześć',
          deck_id: 'deck-1',
          flashcard_topic_assignments: [{ topic_id: 't-1' }],
        },
      ];

      vi.mocked(flashcardService.list).mockResolvedValueOnce({
        success: true,
        data: { items: flashcards, hasMore: false, nextCursor: null },
      });

      const mock = { from: vi.fn() };
      mockCreateClient.mockResolvedValue(mock);
      mock.from.mockReturnValueOnce(qb([{ id: 't-1', name: 'Greeting' }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'deck-1', name: 'My Deck' }]));

      const result = await service.exportCsv(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toContain('Hello');
      expect(result.data).toContain('Cześć');
    });

    it('filters by ids', async () => {
      const flashcards = [
        {
          id: 'fc-1',
          front: 'A',
          back: 'B',
          flashcard_topic_assignments: [],
        },
        {
          id: 'fc-2',
          front: 'C',
          back: 'D',
          flashcard_topic_assignments: [],
        },
      ];

      vi.mocked(flashcardService.list).mockResolvedValueOnce({
        success: true,
        data: { items: flashcards, hasMore: false, nextCursor: null },
      });

      const mock = { from: vi.fn() };
      mockCreateClient.mockResolvedValue(mock);
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.exportCsv(ctx, { ids: ['fc-1'] });

      expect(result.success).toBe(true);
      expect(result.data).toContain('A');
      expect(result.data).not.toContain('C');
    });

    it('returns error on list failure', async () => {
      vi.mocked(flashcardService.list).mockResolvedValueOnce({
        success: false,
        error: 'INTERNAL_SERVER',
      });

      const result = await service.exportCsv(ctx);

      expect(result.success).toBe(false);
    });

    it('handles pagination', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        id: `fc-${i}`,
        front: `F${i}`,
        back: `B${i}`,
        flashcard_topic_assignments: [],
      }));

      vi.mocked(flashcardService.list).mockResolvedValueOnce({
        success: true,
        data: { items: page1, hasMore: true, nextCursor: 'cursor1' },
      });

      vi.mocked(flashcardService.list).mockResolvedValueOnce({
        success: true,
        data: { items: [], hasMore: false, nextCursor: null },
      });

      const mock = { from: vi.fn() };
      mockCreateClient.mockResolvedValue(mock);
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.exportCsv(ctx);

      expect(result.success).toBe(true);
    });

    it('escapes CSV values with commas', async () => {
      const flashcards = [
        {
          id: 'fc-1',
          front: 'Hello, world',
          back: 'Test"quote',
          flashcard_topic_assignments: [],
        },
      ];

      vi.mocked(flashcardService.list).mockResolvedValueOnce({
        success: true,
        data: { items: flashcards, hasMore: false, nextCursor: null },
      });

      const mock = { from: vi.fn() };
      mockCreateClient.mockResolvedValue(mock);
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.exportCsv(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toContain('"Hello, world"');
      expect(result.data).toContain('"Test""quote"');
    });
  });
});
