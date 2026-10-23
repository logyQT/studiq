import { AccountType, type RequestContext } from '@studiq/authz';
import { check } from '@studiq/server/lib/authz';
import { AppError } from '@studiq/server/lib/errors';
import { FlashcardDeckService } from '@studiq/server/services/flashcard-deck.service';
import { groupService } from '@studiq/server/services/group.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@studiq/server/lib/authz')>();
  return { ...actual, check: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('@studiq/server/services/limits.resolver', () => ({
  limitsResolver: { checkLimit: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@studiq/server/services/group.service', () => ({
  groupService: { canShareContentToGroups: vi.fn() },
}));

function qb(data: any, error: any = null, count?: number) {
  const result =
    count !== undefined ? { data: data ?? null, count, error } : { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.limit = vi.fn(() => b);
  b.or = vi.fn(() => b);
  b.not = vi.fn(() => b);
  b.neq = vi.fn(() => b);
  b.rpc = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('FlashcardDeckService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: FlashcardDeckService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
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
    mock = mockSupabaseClient();
    service = new FlashcardDeckService(async () => mock as any);
    vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
      success: true,
      data: true,
    });
  });

  describe('create', () => {
    const foreignCard = { id: 'fc-teacher', created_by: 'teacher-1', organization_id: 'org-1' };

    it('checks flashcard.update on flashcardIds before inserting the deck', async () => {
      const mockDeck = { id: 'd-1', name: 'Study Deck', created_by: ctx.userId };

      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb([foreignCard]));
      mock.from.mockReturnValueOnce(qb(mockDeck));
      mock.from.mockReturnValueOnce(qb(null));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb(mockDeck));

      const result = await service.create(
        { name: 'Study Deck', flashcardIds: ['fc-teacher'] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(vi.mocked(check)).toHaveBeenCalledWith(ctx, 'flashcard.update', foreignCard);
      expect(mock.from.mock.calls.map((c) => c[0])).toEqual([
        'flashcard_decks',
        'flashcards',
        'flashcard_decks',
        'flashcards',
        'suspended_decks',
        'flashcard_decks',
      ]);
    });

    it('rejects and never inserts the deck when a card is not updatable', async () => {
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb([foreignCard]));
      vi.mocked(check).mockRejectedValueOnce(new AppError('FORBIDDEN'));

      await expect(
        service.create({ name: 'Study Deck', flashcardIds: ['fc-teacher'] }, ctx),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // The deck insert is never reached.
      expect(mock.from.mock.calls.map((c) => c[0])).toEqual(['flashcard_decks', 'flashcards']);
    });

    it('rejects unknown card ids instead of silently skipping the guard', async () => {
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.create(
        { name: 'Study Deck', flashcardIds: ['fc-missing'] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      expect(mock.from.mock.calls.map((c) => c[0])).toEqual(['flashcard_decks', 'flashcards']);
    });

    it('inserts deck and returns it', async () => {
      const mockDeck = { id: 'd-1', name: 'Study Deck', created_by: ctx.userId };
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb(mockDeck));
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(mockDeck));

      const result = await service.create({ name: 'Study Deck' }, ctx);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('flashcard_decks');
    });

    it('returns INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.create({ name: 'Study Deck' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('links a group deck when the caller teaches the requested groups', async () => {
      const mockDeck = { id: 'd-1', name: 'Group Deck', created_by: ctx.userId };
      mock.from.mockReturnValueOnce(qb([], null, 0)); // deck count
      mock.from.mockReturnValueOnce(qb(mockDeck)); // deck insert
      mock.from.mockReturnValueOnce(qb(undefined)); // deck_groups insert
      mock.from.mockReturnValueOnce(qb([], null)); // suspended decks
      mock.from.mockReturnValueOnce(qb(mockDeck)); // getById

      const result = await service.create(
        { name: 'Group Deck', visibility: 'group', groupIds: ['g-1'] },
        { ...ctx, activeOrgId: 'org-1' },
      );

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(expect.anything(), ['g-1']);
      expect(mock.from).toHaveBeenCalledWith('deck_groups');
      const insertCall = mock.from.mock.results[2].value.insert;
      expect(insertCall).toHaveBeenCalledWith([{ deck_id: 'd-1', group_id: 'g-1' }]);
    });

    it('returns FORBIDDEN and writes nothing when the caller cannot share to the group', async () => {
      vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
        success: true,
        data: false,
      });

      const result = await service.create(
        { name: 'Group Deck', visibility: 'group', groupIds: ['g-untaugh'] },
        { ...ctx, activeOrgId: 'org-1' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(expect.anything(), [
        'g-untaugh',
      ]);
      // The guard runs before any write — not even the deck count query runs.
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('propagates the helper failure code', async () => {
      vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
        success: false,
        error: 'INTERNAL_SERVER',
      });

      const result = await service.create(
        { name: 'Group Deck', visibility: 'group', groupIds: ['g-1'] },
        { ...ctx, activeOrgId: 'org-1' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('does not run the group guard for a personal deck', async () => {
      const mockDeck = { id: 'd-1', name: 'Personal Deck', created_by: ctx.userId };
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb(mockDeck));
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(mockDeck));

      const result = await service.create({ name: 'Personal Deck', visibility: 'personal' }, ctx);

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns decks for user', async () => {
      const decks = [
        { id: 'd-1', name: 'Study Deck', flashcard_count: 0, groupIds: [], suspended: false },
      ];
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(decks));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('returns INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.list(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('returns empty result for groupFilter=mine when the caller has no groups', async () => {
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb([], null));

      const result = await service.list(ctx, { groupFilter: 'mine' } as any);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ items: [], nextCursor: null, hasMore: false });
    });

    it('filters to decks shared with the caller groups when groupFilter=mine', async () => {
      const groupCtx = { ...ctx, groupIds: ['g-1'] };
      const decks = [
        { id: 'd-1', name: 'Group Deck', flashcard_count: 0, groupIds: ['g-1'], suspended: false },
      ];
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb([{ deck_id: 'd-1' }], null));
      mock.from.mockReturnValueOnce(qb(decks));

      const result = await service.list(groupCtx, { groupFilter: 'mine' } as any);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('deck_groups');
    });
  });

  describe('getById', () => {
    it('returns deck when found', async () => {
      const deck = { id: 'd-1', name: 'Study Deck' };
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(deck));

      const result = await service.getById('d-1', ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when deck does not exist', async () => {
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getById('nonexistent', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('update', () => {
    it('updates deck and returns it', async () => {
      const existing = { id: 'd-1', name: 'Original', created_by: ctx.userId };
      const updated = { id: 'd-1', name: 'Updated', created_by: ctx.userId };
      mock.from.mockReturnValueOnce(qb(existing));
      mock.from.mockReturnValueOnce(qb(updated));
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(updated));

      const result = await service.update('d-1', { name: 'Updated' }, ctx);

      expect(result.success).toBe(true);
    });

    it('rejects flashcardIds the caller cannot update before mutating the deck', async () => {
      const existing = { id: 'd-1', name: 'Original', created_by: ctx.userId };
      const foreignCard = { id: 'fc-teacher', created_by: 'teacher-1', organization_id: 'org-1' };
      mock.from.mockReturnValueOnce(qb(existing));
      mock.from.mockReturnValueOnce(qb([foreignCard]));
      vi.mocked(check)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new AppError('FORBIDDEN'));

      await expect(
        service.update('d-1', { flashcardIds: ['fc-teacher'] }, ctx),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(vi.mocked(check).mock.calls.map((c) => [c[1], c[2]])).toEqual([
        ['deck.update', existing],
        ['flashcard.update', foreignCard],
      ]);
      // Only the deck lookup and the card guard ran — no update statements.
      expect(mock.from.mock.calls.map((c) => c[0])).toEqual(['flashcard_decks', 'flashcards']);
    });

    it('returns NOT_FOUND when deck does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.update('nonexistent', { name: 'Updated' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns FORBIDDEN and leaves links untouched when adding an untaught group', async () => {
      const existing = { id: 'd-1', name: 'Original', created_by: ctx.userId, visibility: 'group' };
      mock.from.mockReturnValueOnce(qb(existing));
      vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
        success: true,
        data: false,
      });

      const result = await service.update(
        'd-1',
        { groupIds: ['g-untaugh'] },
        { ...ctx, activeOrgId: 'org-1' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(expect.anything(), [
        'g-untaugh',
      ]);
      // Only the existence read happened — no deck update, no group link writes.
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('deck_groups');
    });

    it('replaces group links when every requested group is taught', async () => {
      const existing = { id: 'd-1', name: 'Original', created_by: ctx.userId, visibility: 'group' };
      const linked = { id: 'd-1', name: 'Original', created_by: ctx.userId, groupIds: ['g-1'] };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(undefined)); // delete links
      mock.from.mockReturnValueOnce(qb(undefined)); // insert links
      mock.from.mockReturnValueOnce(qb([], null)); // suspended decks
      mock.from.mockReturnValueOnce(qb(linked)); // getById

      const result = await service.update(
        'd-1',
        { groupIds: ['g-1'] },
        { ...ctx, activeOrgId: 'org-1' },
      );

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(expect.anything(), ['g-1']);
      const insertCall = mock.from.mock.results[2].value.insert;
      expect(insertCall).toHaveBeenCalledWith([{ deck_id: 'd-1', group_id: 'g-1' }]);
    });

    it('clears group links for an empty groupIds list without calling the guard', async () => {
      const existing = { id: 'd-1', name: 'Original', created_by: ctx.userId, visibility: 'group' };
      const cleared = { id: 'd-1', name: 'Original', created_by: ctx.userId, groupIds: [] };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(undefined)); // delete links
      mock.from.mockReturnValueOnce(qb([], null)); // suspended decks
      mock.from.mockReturnValueOnce(qb(cleared)); // getById

      const result = await service.update('d-1', { groupIds: [] }, ctx);

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      expect(mock.from).toHaveBeenCalledWith('deck_groups');
    });
  });

  describe('delete', () => {
    it('deletes deck successfully', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'd-1', created_by: ctx.userId }));
      mock.from.mockReturnValueOnce(qb({ id: 'd-1' }));

      const result = await service.delete('d-1', ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when deck does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.delete('nonexistent', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });
});
