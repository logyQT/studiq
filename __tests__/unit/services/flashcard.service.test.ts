import { AccountType, type RequestContext } from '@studiq/authz';
import { check } from '@studiq/server/lib/authz';
import { AppError } from '@studiq/server/lib/errors';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { FlashcardService } from '@studiq/server/services/flashcard.service';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

/** Narrows a service result to its data, failing the test when the call failed. */
function expectSuccess<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

vi.mock('@studiq/server/lib/authz', () => {
  const checkMock = vi.fn().mockResolvedValue(undefined);
  return {
    check: checkMock,
    accessibleFilter: vi.fn().mockResolvedValue({}),
    can: vi.fn().mockResolvedValue(true),
    Permission: {
      FLASHCARD_READ: 'flashcard.read',
      FLASHCARD_UPDATE: 'flashcard.update',
      FLASHCARD_DELETE: 'flashcard.delete',
      TOPIC_READ: 'topic.read',
      DECK_UPDATE: 'deck.update',
    },
  };
});

vi.mock('@studiq/server/services/limits', () => ({
  limitsResolver: { checkLimit: vi.fn().mockResolvedValue(undefined) },
}));

type ChainResult = { data: unknown; count?: number; error: null };

interface FakeQueryBuilder<T> {
  select: Mock;
  eq: Mock;
  in: Mock;
  or: Mock;
  order: Mock;
  filter: Mock;
  limit: Mock;
  single: Mock;
  maybeSingle: Mock;
  insert: Mock;
  update: Mock;
  delete: Mock;
  upsert: Mock;
  then: Promise<T>['then'];
}

function chain(result: unknown, count?: number): FakeQueryBuilder<ChainResult> {
  const resolved: ChainResult =
    count !== undefined ? { data: result, count, error: null } : { data: result, error: null };
  const promise = Promise.resolve(resolved);
  const terminal = vi.fn().mockResolvedValue(resolved);
  const c: FakeQueryBuilder<ChainResult> = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    filter: vi.fn(),
    limit: vi.fn(),
    single: terminal,
    maybeSingle: terminal,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
    then: promise.then.bind(promise),
  };
  for (const method of [
    c.select,
    c.eq,
    c.in,
    c.or,
    c.order,
    c.filter,
    c.limit,
    c.insert,
    c.update,
    c.delete,
    c.upsert,
  ]) {
    method.mockImplementation(() => c);
  }
  return c;
}

/** A read the database refuses. */
function failingRead() {
  const failed = { data: null, error: { code: 'XX000', message: 'connection reset' } };
  const builder = chain(null);
  const promise = Promise.resolve(failed);
  // On the builder itself: its chain methods return it, so a copy would be left behind.
  return Object.assign(builder, { then: promise.then.bind(promise) });
}

describe('FlashcardService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.STUDENT,
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };
  const service = new FlashcardService(() => Promise.resolve(mock));

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('create', () => {
    it('inserts flashcard', async () => {
      const mockFlashcard = { id: 'fc-1', front: 'Q', back: 'A' };

      mock.from.mockReturnValueOnce(chain([], 0));
      mock.from.mockReturnValue(chain(mockFlashcard));

      const result = await service.create({ front: 'Q', back: 'A' }, ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toEqual(mockFlashcard);
      expect(mock.from).toHaveBeenCalledWith('flashcards');
    });

    it('inserts flashcard with organization_id when activeOrgId is set', async () => {
      const mockFlashcard = { id: 'fc-1', front: 'Q', back: 'A' };
      const orgCtx = { ...ctx, activeOrgId: 'uni-1' };

      const insertChain = chain(mockFlashcard);
      mock.from.mockReturnValueOnce(chain([], 0));
      mock.from.mockReturnValue(insertChain);

      const result = await service.create({ front: 'Q', back: 'A' }, orgCtx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toEqual(mockFlashcard);
      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: 'uni-1', created_by: ctx.userId }),
      );
    });

    it('counts only the caller content in the active org (#233)', async () => {
      const countChain = chain([], 0);
      mock.from.mockReturnValueOnce(countChain);
      mock.from.mockReturnValue(chain({ id: 'fc-1' }));

      await service.create({ front: 'Q', back: 'A' }, { ...ctx, activeOrgId: 'uni-1' });

      expect(countChain.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(countChain.eq).toHaveBeenCalledWith('organization_id', 'uni-1');
    });

    it('does not filter the count by org outside an org context (#233)', async () => {
      const countChain = chain([], 0);
      mock.from.mockReturnValueOnce(countChain);
      mock.from.mockReturnValue(chain({ id: 'fc-1' }));

      await service.create({ front: 'Q', back: 'A' }, ctx);

      expect(countChain.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(countChain.eq).not.toHaveBeenCalledWith('organization_id', expect.anything());
    });

    it('returns INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValueOnce(chain([], 0));
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      const result = await service.create({ front: 'Q', back: 'A' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('bulkCreate', () => {
    it('counts only the caller content in the active org on the bulk path (#233)', async () => {
      const flashcards = [{ id: 'fc-1', front: 'Q1', back: 'A1' }];
      const countChain = chain([], 0);
      mock.from.mockReturnValueOnce(countChain);
      mock.rpc.mockResolvedValue({ data: flashcards, error: null });

      await service.bulkCreate(
        { cards: [{ front: 'Q1', back: 'A1' }] },
        { ...ctx, activeOrgId: 'uni-1' },
      );

      expect(countChain.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(countChain.eq).toHaveBeenCalledWith('organization_id', 'uni-1');
    });

    it('returns INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValueOnce(chain([], 0));
      mock.rpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

      const result = await service.bulkCreate({ cards: [{ front: 'Q1', back: 'A1' }] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('creates topic assignments when topicIds provided', async () => {
      const flashcards = [
        { id: 'fc-1', front: 'Q1', back: 'A1' },
        { id: 'fc-2', front: 'Q2', back: 'A2' },
      ];

      mock.from.mockReturnValueOnce(chain([], 0));
      mock.from.mockReturnValueOnce(chain([{ id: 't-1' }]));
      mock.rpc.mockResolvedValue({ data: flashcards, error: null });

      const result = await service.bulkCreate(
        {
          cards: [
            { front: 'Q1', back: 'A1' },
            { front: 'Q2', back: 'A2' },
          ],
          topicIds: ['t-1'],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toEqual(flashcards);
      expect(mock.rpc).toHaveBeenCalledWith(
        'bulk_create_flashcards',
        expect.objectContaining({ p_topic_ids: ['t-1'] }),
      );
    });
  });

  describe('list', () => {
    it('returns flashcards scoped to user', async () => {
      const flashcards = [{ id: 'fc-1', front: 'Q', back: 'A' }];

      mock.from.mockReturnValue(chain(flashcards));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result).items).toEqual(flashcards);
    });

    it('filters by topicIds when provided', async () => {
      const flashcards = [{ id: 'fc-1', front: 'Q', back: 'A' }];
      const listChain = chain(flashcards);

      mock.from.mockReturnValue(listChain);

      const result = await service.list(ctx, { topicIds: ['t-1'] });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).items).toEqual(flashcards);
      // The filter is what narrows the rows, and the `!inner` projection is what makes it bind.
      expect(listChain.filter).toHaveBeenCalledWith(
        'flashcard_topic_assignments.topic_id',
        'eq',
        't-1',
      );
      expect(listChain.select).toHaveBeenCalledWith(expect.stringContaining('!inner') as unknown);
    });

    it('filters by deckIds when provided', async () => {
      const flashcards = [{ id: 'fc-1', front: 'Q', back: 'A' }];
      const listChain = chain(flashcards);

      mock.from.mockReturnValue(listChain);

      const result = await service.list(ctx, { deckIds: ['d-1'] });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).items).toEqual(flashcards);
      expect(listChain.filter).toHaveBeenCalledWith('deck_id', 'eq', 'd-1');
    });
  });

  describe('getById', () => {
    it('returns flashcard when found', async () => {
      const flashcard = { id: 'fc-1', front: 'Q', back: 'A' };

      mock.from.mockReturnValue(chain(flashcard));

      const result = await service.getById('fc-1', ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toEqual(flashcard);
    });

    it('returns NOT_FOUND when flashcard does not exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.getById('nonexistent', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('update', () => {
    it('updates flashcard and returns it', async () => {
      const updated = { id: 'fc-1', front: 'Updated', back: 'A' };

      const updateChain = chain(updated);
      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(updateChain);
      mock.from.mockReturnValue(chain(updated));

      const result = await service.update('fc-1', { front: 'Updated' }, ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toBeDefined();
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ front: 'Updated' }),
      );
      expect(updateChain.eq).toHaveBeenCalledWith('id', 'fc-1');
    });

    it('returns NOT_FOUND when flashcard does not exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.update('fc-1', { front: 'Updated' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('updates topic assignments when topicIds provided', async () => {
      const updated = { id: 'fc-1', front: 'Updated', back: 'A' };

      const clearChain = chain(null);
      const assignChain = chain(null);
      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(chain([{ id: 't-1' }]));
      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(clearChain);
      mock.from.mockReturnValueOnce(assignChain);
      mock.from.mockReturnValue(chain(updated));

      const result = await service.update('fc-1', { front: 'Updated', topicIds: ['t-1'] }, ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toBeDefined();
      // Reassignment is a full replace: clear first, then write the new links.
      expect(clearChain.delete).toHaveBeenCalled();
      expect(clearChain.eq).toHaveBeenCalledWith('flashcard_id', 'fc-1');
      expect(assignChain.insert).toHaveBeenCalledWith([{ flashcard_id: 'fc-1', topic_id: 't-1' }]);
    });

    it('updates deck_id when deckId provided', async () => {
      const updated = { id: 'fc-1', front: 'Updated', back: 'A' };

      const deckChain = chain(null);
      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(deckChain);
      mock.from.mockReturnValue(chain(updated));

      const result = await service.update('fc-1', { front: 'Updated', deckId: 'd-1' }, ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toBeDefined();
      expect(deckChain.update).toHaveBeenCalledWith({ deck_id: 'd-1' });
      expect(deckChain.eq).toHaveBeenCalledWith('id', 'fc-1');
    });

    it('clears topic assignments when topicIds is empty array', async () => {
      const updated = { id: 'fc-1', front: 'Updated', back: 'A' };

      const clearChain = chain(null);
      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(chain(updated));
      mock.from.mockReturnValueOnce(clearChain);
      mock.from.mockReturnValue(chain(updated));

      const result = await service.update('fc-1', { topicIds: [] }, ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toBeDefined();
      // An empty list clears the links: the delete runs even though nothing is inserted.
      expect(clearChain.delete).toHaveBeenCalled();
      expect(clearChain.eq).toHaveBeenCalledWith('flashcard_id', 'fc-1');
    });
  });

  describe('batchMove', () => {
    const ownCard = { id: 'fc-own', created_by: ctx.userId, organization_id: 'org-1' };
    const teacherCard = { id: 'fc-teacher', created_by: 'teacher-1', organization_id: 'org-1' };
    const targetDeck = { id: 'deck-target', created_by: ctx.userId, organization_id: 'org-1' };

    it('moves every card and gates each card plus the target deck', async () => {
      mock.from.mockReturnValueOnce(chain([ownCard, teacherCard]));
      mock.from.mockReturnValueOnce(chain(targetDeck));
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.batchMove(
        {
          ids: ['fc-own', 'fc-teacher'],
          sourceDeckId: 'deck-source',
          targetDeckId: 'deck-target',
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toEqual({ moved: 2 });
      expect(vi.mocked(check)).toHaveBeenCalledWith(ctx, 'flashcard.update', ownCard);
      expect(vi.mocked(check)).toHaveBeenCalledWith(ctx, 'flashcard.update', teacherCard);
      expect(vi.mocked(check)).toHaveBeenCalledWith(ctx, 'deck.update', targetDeck);
      expect(vi.mocked(check)).not.toHaveBeenCalledWith(ctx, 'flashcard.read', teacherCard);
    });

    it('rejects the whole batch when a foreign card is not updatable, before updating', async () => {
      mock.from.mockReturnValueOnce(chain([ownCard, teacherCard]));
      vi.mocked(check)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new AppError('FORBIDDEN'));

      await expect(
        service.batchMove(
          {
            ids: ['fc-own', 'fc-teacher'],
            sourceDeckId: 'deck-source',
            targetDeckId: 'deck-target',
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // Only the card fetch happened: no deck lookup and no update statement.
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('returns NOT_FOUND when the target deck is missing', async () => {
      mock.from.mockReturnValueOnce(chain([ownCard]));
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.batchMove(
        { ids: ['fc-own'], sourceDeckId: 'deck-source', targetDeckId: 'deck-missing' },
        ctx,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('NOT_FOUND');
      // Cards fetched + deck lookup only; no update statement.
      expect(mock.from).toHaveBeenCalledTimes(2);
    });
  });

  describe('batchDelete', () => {
    const ownCard = { id: 'fc-own', created_by: ctx.userId, organization_id: 'org-1' };
    const otherCard = { id: 'fc-other', created_by: 'teacher-1', organization_id: 'org-1' };

    it('deletes all requested cards and gates each on flashcard.delete', async () => {
      mock.from.mockReturnValueOnce(chain([ownCard, otherCard]));
      mock.from.mockReturnValueOnce(chain(null));

      const result = await service.batchDelete({ ids: ['fc-own', 'fc-other'] }, ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toEqual({ deleted: 2 });
      expect(vi.mocked(check)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(check)).toHaveBeenCalledWith(ctx, 'flashcard.delete', ownCard);
      expect(vi.mocked(check)).toHaveBeenCalledWith(ctx, 'flashcard.delete', otherCard);
      expect(mock.from).toHaveBeenLastCalledWith('flashcards');
    });

    it('returns NOT_FOUND when no card matches', async () => {
      mock.from.mockReturnValueOnce(chain([]));

      const result = await service.batchDelete({ ids: ['fc-missing'] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      expect(vi.mocked(check)).not.toHaveBeenCalled();
      // No delete statement was issued.
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('rejects the whole batch when a card is not deletable, before deleting', async () => {
      mock.from.mockReturnValueOnce(chain([ownCard, otherCard]));
      vi.mocked(check)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new AppError('FORBIDDEN'));

      await expect(service.batchDelete({ ids: ['fc-own', 'fc-other'] }, ctx)).rejects.toMatchObject(
        { code: 'FORBIDDEN' },
      );

      // Only the fetch happened: nothing was deleted.
      expect(mock.from).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it('deletes flashcard successfully', async () => {
      const existing = { id: 'fc-1', front: 'Q', back: 'A' };

      const deleteChain = chain(null);
      mock.from.mockReturnValueOnce(chain(existing));
      mock.from.mockReturnValue(deleteChain);

      const result = await service.delete('fc-1', ctx);

      expect(result.success).toBe(true);
      expect(deleteChain.delete).toHaveBeenCalled();
      expect(deleteChain.eq).toHaveBeenCalledWith('id', 'fc-1');
      expect(vi.mocked(check)).toHaveBeenCalledWith(ctx, 'flashcard.delete', existing);
    });

    it('returns NOT_FOUND when flashcard does not exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.delete('fc-1', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('topic links (#1515)', () => {
    const card = { id: 'fc-1', front: 'Q', back: 'A' };

    it('copies a card with only the topics the caller can read (#1541)', async () => {
      const links = chain(null);
      mock.from.mockReturnValueOnce(chain(card));
      mock.from.mockReturnValueOnce(chain({ id: 'd-1', visibility: 'personal' }));
      mock.from.mockReturnValueOnce(chain([{ topic_id: 't-1' }, { topic_id: 't-x' }]));
      mock.from.mockReturnValueOnce(chain([{ id: 't-1' }]));
      mock.from.mockReturnValueOnce(chain({ id: 'fc-new' }));
      mock.from.mockReturnValueOnce(links);
      mock.from.mockReturnValue(chain({ id: 'fc-new' }));

      const result = await service.copy('fc-1', { targetDeckId: 'd-1' }, ctx);

      expect(result.success).toBe(true);
      expect(links.insert).toHaveBeenCalledWith([{ flashcard_id: 'fc-new', topic_id: 't-1' }]);
    });

    it('batch copies cards with only the topics the caller can read (#1541)', async () => {
      const links = chain(null);
      mock.from.mockReturnValueOnce(chain([card]));
      mock.from.mockReturnValueOnce(chain({ id: 'd-1', visibility: 'personal' }));
      mock.from.mockReturnValueOnce(
        chain([
          { flashcard_id: 'fc-1', topic_id: 't-1' },
          { flashcard_id: 'fc-1', topic_id: 't-x' },
        ]),
      );
      mock.from.mockReturnValueOnce(chain([{ id: 't-1' }]));
      mock.from.mockReturnValueOnce(chain([{ id: 'fc-new' }]));
      mock.from.mockReturnValue(links);

      const result = await service.batchCopy({ ids: ['fc-1'], targetDeckId: 'd-1' }, ctx);

      expect(result.success).toBe(true);
      expect(links.insert).toHaveBeenCalledWith([{ flashcard_id: 'fc-new', topic_id: 't-1' }]);
    });

    it.each(['copy', 'batchCopy'] as const)(
      '%s creates no card when the topic access read fails',
      async (method) => {
        const rest = chain([{ id: 'fc-new' }]);
        mock.from.mockReturnValueOnce(chain(method === 'copy' ? card : [card]));
        mock.from.mockReturnValueOnce(chain({ id: 'd-1', visibility: 'personal' }));
        mock.from.mockReturnValueOnce(chain([{ flashcard_id: 'fc-1', topic_id: 't-1' }]));
        mock.from.mockReturnValueOnce(failingRead());
        mock.from.mockReturnValue(rest);

        const result =
          method === 'copy'
            ? await service.copy('fc-1', { targetDeckId: 'd-1' }, ctx)
            : await service.batchCopy({ ids: ['fc-1'], targetDeckId: 'd-1' }, ctx);

        expect(result.success).toBe(false);
        // A retry after this error must not find a first copy already made.
        expect(rest.insert).not.toHaveBeenCalled();
        expect(mock.from).toHaveBeenCalledTimes(4);
      },
    );

    it('refuses create with an unreadable topic and writes nothing', async () => {
      const cards = chain([], 0);
      mock.from.mockReturnValueOnce(cards);
      mock.from.mockReturnValueOnce(chain([]));
      // Anything after the lookup resolves, so the assertions below are what fail.
      mock.from.mockReturnValue(cards);

      const result = await service.create({ front: 'Q', back: 'A', topicIds: ['t-x'] }, ctx);

      expect(result).toMatchObject({ success: false, error: 'NOT_FOUND' });
      expect(cards.insert).not.toHaveBeenCalled();
      expect(mock.from).toHaveBeenCalledTimes(2);
    });

    it('refuses the whole bulk create when one topic is unreadable', async () => {
      mock.from.mockReturnValueOnce(chain([], 0));
      mock.from.mockReturnValueOnce(chain([{ id: 't-1' }]));
      mock.rpc.mockResolvedValue({ data: [card], error: null });

      const result = await service.bulkCreate(
        { cards: [{ front: 'Q', back: 'A' }], topicIds: ['t-1', 't-x'] },
        ctx,
      );

      expect(result).toMatchObject({ success: false, error: 'NOT_FOUND' });
      expect(mock.rpc).not.toHaveBeenCalled();
    });

    it('refuses an update that adds an unreadable topic, before any write', async () => {
      const writes = chain(null);
      mock.from.mockReturnValueOnce(chain(card));
      mock.from.mockReturnValueOnce(chain([]));
      mock.from.mockReturnValueOnce(chain([]));
      mock.from.mockReturnValue(writes);

      const result = await service.update('fc-1', { front: 'New', topicIds: ['t-x'] }, ctx);

      expect(result).toMatchObject({ success: false, error: 'NOT_FOUND' });
      // The card, the topic lookup and the existing links: no query after them.
      expect(mock.from).toHaveBeenCalledTimes(3);
    });

    it('keeps an unreadable topic that the card already carries', async () => {
      const writes = chain(card);
      mock.from.mockReturnValueOnce(chain(card));
      mock.from.mockReturnValueOnce(chain([]));
      mock.from.mockReturnValueOnce(chain([{ flashcard_id: 'fc-1', topic_id: 't-x' }]));
      mock.from.mockReturnValue(writes);

      const result = await service.update('fc-1', { topicIds: ['t-x'] }, ctx);

      expect(result.success).toBe(true);
      expect(writes.insert).toHaveBeenCalledWith([{ flashcard_id: 'fc-1', topic_id: 't-x' }]);
    });

    it('refuses batch add of an unreadable topic and inserts no link', async () => {
      const writes = chain([]);
      mock.from.mockReturnValueOnce(chain([card]));
      mock.from.mockReturnValueOnce(chain([]));
      mock.from.mockReturnValueOnce(chain([]));
      mock.from.mockReturnValue(writes);

      const result = await service.batchTopics(
        { ids: ['fc-1'], operation: 'add', topicIds: ['t-x'] },
        ctx,
      );

      expect(result).toMatchObject({ success: false, error: 'NOT_FOUND' });
      expect(writes.insert).not.toHaveBeenCalled();
    });

    it('lets the caller remove a topic that they cannot read', async () => {
      const removal = chain(null);
      mock.from.mockReturnValueOnce(chain([card]));
      mock.from.mockReturnValue(removal);

      const result = await service.batchTopics(
        { ids: ['fc-1'], operation: 'remove', topicIds: ['t-x'] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(removal.delete).toHaveBeenCalled();
      expect(removal.in).toHaveBeenCalledWith('topic_id', ['t-x']);
      // The card read and the delete: removing asks for no topic access.
      expect(mock.from).toHaveBeenCalledTimes(2);
    });

    it('refuses batch set when only some cards carry the topic, before the delete', async () => {
      const writes = chain(null);
      mock.from.mockReturnValueOnce(chain([card, { ...card, id: 'fc-2' }]));
      mock.from.mockReturnValueOnce(chain([]));
      mock.from.mockReturnValueOnce(chain([{ flashcard_id: 'fc-1', topic_id: 't-x' }]));
      mock.from.mockReturnValue(writes);

      const result = await service.batchTopics(
        { ids: ['fc-1', 'fc-2'], operation: 'set', topicIds: ['t-x'] },
        ctx,
      );

      expect(result).toMatchObject({ success: false, error: 'NOT_FOUND' });
      expect(writes.delete).not.toHaveBeenCalled();
      expect(writes.insert).not.toHaveBeenCalled();
    });
  });
});
