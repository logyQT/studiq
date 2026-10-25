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
  b.upsert = vi.fn(() => b);
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

    it('counts only the caller content in the active org (#233)', async () => {
      const countBuilder = qb([], null, 0);
      mock.from.mockReturnValueOnce(countBuilder);
      mock.from.mockReturnValueOnce(qb({ id: 'd-1' }));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb({ id: 'd-1', name: 'Study Deck' }));

      await service.create({ name: 'Study Deck' }, { ...ctx, activeOrgId: 'org-1' });

      expect(countBuilder.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(countBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    });

    it('does not filter the count by org outside an org context (#233)', async () => {
      const countBuilder = qb([], null, 0);
      mock.from.mockReturnValueOnce(countBuilder);
      mock.from.mockReturnValueOnce(qb({ id: 'd-1' }));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb({ id: 'd-1', name: 'Study Deck' }));

      await service.create({ name: 'Study Deck' }, ctx);

      expect(countBuilder.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(countBuilder.eq).not.toHaveBeenCalledWith('organization_id', expect.anything());
    });

    // #139 — group visibility without a single share link is only visible to the creator.
    it('rejects a group deck with no groupIds before touching the database', async () => {
      const result = await service.create(
        { name: 'Group Deck', visibility: 'group' },
        { ...ctx, activeOrgId: 'org-1' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('rejects a group deck with an empty groupIds list', async () => {
      const result = await service.create(
        { name: 'Group Deck', visibility: 'group', groupIds: [] },
        { ...ctx, activeOrgId: 'org-1' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      expect(mock.from).not.toHaveBeenCalled();
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
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(
        expect.anything(),
        ['g-1'],
        'org-1',
      );
      expect(mock.from).toHaveBeenCalledWith('deck_groups');
      const insertCall = mock.from.mock.results[2].value.insert;
      expect(insertCall).toHaveBeenCalledWith([{ deck_id: 'd-1', group_id: 'g-1' }]);
    });

    it('de-duplicates group ids before authorizing and inserting', async () => {
      const mockDeck = { id: 'd-1', name: 'Group Deck', created_by: ctx.userId };
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb(mockDeck));
      mock.from.mockReturnValueOnce(qb(undefined));
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(mockDeck));

      const result = await service.create(
        { name: 'Group Deck', visibility: 'group', groupIds: ['g-1', 'g-1'] },
        { ...ctx, activeOrgId: 'org-1' },
      );

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(
        expect.anything(),
        ['g-1'],
        'org-1',
      );
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
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(
        expect.anything(),
        ['g-untaugh'],
        'org-1',
      );
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
      mock.from.mockReturnValueOnce(qb(null, null, 1));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('returns the total of all matching decks, independent of page size', async () => {
      const decks = [
        { id: 'd-1', name: 'A' },
        { id: 'd-2', name: 'B' },
        { id: 'd-3', name: 'C' },
      ];
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(decks));
      mock.from.mockReturnValueOnce(qb(null, null, 57));

      const result = await service.list(ctx, { limit: 2 } as any);

      expect(result.success).toBe(true);
      const data = result.data as { items: unknown[]; hasMore: boolean; total: number };
      expect(data.items).toHaveLength(2);
      expect(data.hasMore).toBe(true);
      expect(data.total).toBe(57);
    });

    it('counts with a head query that applies the same filters but not cursor or limit', async () => {
      const pageQb = qb([{ id: 'd-1', name: 'A' }]);
      const countQb = qb(null, null, 4);
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(pageQb);
      mock.from.mockReturnValueOnce(countQb);

      const cursor = Buffer.from(JSON.stringify({ v: '2025-01-01T00:00:00Z', id: 'd-0' })).toString(
        'base64url',
      );
      const result = await service.list(ctx, {
        owner: 'mine',
        q: 'bio',
        cursor,
        limit: 10,
      } as any);

      expect((result.data as { total: number }).total).toBe(4);
      expect(countQb.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
      // owner + search filters are applied to both queries
      expect(countQb.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(pageQb.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      const searchOr = 'name.ilike.%bio%,description.ilike.%bio%';
      expect(countQb.or).toHaveBeenCalledWith(searchOr);
      expect(pageQb.or).toHaveBeenCalledWith(searchOr);
      // cursor + limit only on the page query
      expect(pageQb.limit).toHaveBeenCalledWith(11);
      expect(pageQb.or).toHaveBeenCalledTimes(2);
      expect(countQb.or).toHaveBeenCalledTimes(1);
      expect(countQb.limit).not.toHaveBeenCalled();
      expect(countQb.order).not.toHaveBeenCalled();
    });

    it('returns INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));
      mock.from.mockReturnValueOnce(qb(null, null, 0));

      const result = await service.list(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('never queries deck_groups when groups is empty', async () => {
      const suspendedQb = qb([], null);
      const pageQb = qb([], null);
      const countQb = qb(null, null, 0);
      mock.from.mockReturnValueOnce(suspendedQb);
      mock.from.mockReturnValueOnce(pageQb);
      mock.from.mockReturnValueOnce(countQb);

      await service.list(ctx, { groups: [] } as any);

      expect(mock.from.mock.calls.map((c) => c[0])).toEqual([
        'suspended_decks',
        'flashcard_decks',
        'flashcard_decks',
      ]);
      expect(pageQb.in).not.toHaveBeenCalled();
    });

    it('narrows both the page and the total count to the resolved group deck ids', async () => {
      const pageQb = qb([{ id: 'd-1', name: 'Group Deck' }]);
      const countQb = qb(null, null, 1);
      mock.from.mockReturnValueOnce(qb([], null)); // suspended_decks
      mock.from.mockReturnValueOnce(qb([{ deck_id: 'd-1' }], null)); // deck_groups
      mock.from.mockReturnValueOnce(qb([{ id: 'd-1' }], null)); // group-visible decks
      mock.from.mockReturnValueOnce(pageQb);
      mock.from.mockReturnValueOnce(countQb);

      const result = await service.list({ ...ctx, groupIds: ['g-1'] }, {
        groups: ['g-1'],
      } as any);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('deck_groups');
      expect(pageQb.in).toHaveBeenCalledWith('id', ['d-1']);
      expect(countQb.in).toHaveBeenCalledWith('id', ['d-1']);
    });

    it('returns an empty page without running the list query when no deck matches the groups', async () => {
      const pageQb = qb([]);
      mock.from.mockReturnValueOnce(qb([], null)); // suspended_decks
      mock.from.mockReturnValueOnce(qb([], null)); // deck_groups → no linked decks

      const result = await service.list({ ...ctx, groupIds: ['g-1'] }, {
        groups: ['g-1'],
      } as any);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        items: [],
        nextCursor: null,
        hasMore: false,
        total: 0,
      });
      expect(mock.from).toHaveBeenCalledTimes(2);
      expect(pageQb.in).not.toHaveBeenCalled();
    });

    it('composes the group filter with owner=mine', async () => {
      const pageQb = qb([]);
      const countQb = qb(null, null, 0);
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb([{ deck_id: 'd-1' }], null));
      mock.from.mockReturnValueOnce(qb([{ id: 'd-1' }], null));
      mock.from.mockReturnValueOnce(pageQb);
      mock.from.mockReturnValueOnce(countQb);

      await service.list({ ...ctx, groupIds: ['g-1'] }, { owner: 'mine', groups: ['g-1'] } as any);

      expect(pageQb.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(pageQb.in).toHaveBeenCalledWith('id', ['d-1']);
      expect(countQb.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(countQb.in).toHaveBeenCalledWith('id', ['d-1']);
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
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(
        expect.anything(),
        ['g-untaugh'],
        'org-1',
      );
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
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(
        expect.anything(),
        ['g-1'],
        'org-1',
      );
      const insertCall = mock.from.mock.results[2].value.insert;
      expect(insertCall).toHaveBeenCalledWith([{ deck_id: 'd-1', group_id: 'g-1' }]);
    });

    it('rejects a group from another org than the deck, even when the caller teaches it there', async () => {
      const existing = {
        id: 'd-1',
        name: 'Original',
        created_by: ctx.userId,
        organization_id: 'org-A',
        visibility: 'group',
      };
      mock.from.mockReturnValueOnce(qb(existing));
      vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
        success: true,
        data: false,
      });

      const result = await service.update(
        'd-1',
        { groupIds: ['g-in-B'] },
        { ...ctx, activeOrgId: 'org-B' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      // The guard receives the deck's org, not the caller's active org.
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(
        expect.anything(),
        ['g-in-B'],
        'org-A',
      );
      // Only the existence read happened — no deck update, no group link writes.
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('deck_groups');
    });

    it('falls back to the active org when the deck has no organization', async () => {
      const existing = {
        id: 'd-1',
        name: 'Original',
        created_by: ctx.userId,
        organization_id: null,
        visibility: 'group',
      };
      const linked = { id: 'd-1', name: 'Original', created_by: ctx.userId, groupIds: ['g-1'] };
      mock.from.mockReturnValueOnce(qb(existing));
      mock.from.mockReturnValueOnce(qb(undefined));
      mock.from.mockReturnValueOnce(qb(undefined));
      mock.from.mockReturnValueOnce(qb([], null));
      mock.from.mockReturnValueOnce(qb(linked));

      const result = await service.update(
        'd-1',
        { groupIds: ['g-1'] },
        { ...ctx, activeOrgId: 'org-B' },
      );

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(
        expect.anything(),
        ['g-1'],
        'org-B',
      );
    });

    // #139 — a group deck must be unshared by switching visibility, never by
    // emptying the link list (that would leave `visibility='group'` with 0 links).
    it('rejects an empty groupIds list on a group deck', async () => {
      const existing = { id: 'd-1', name: 'Original', created_by: ctx.userId, visibility: 'group' };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read

      const result = await service.update('d-1', { groupIds: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      // Only the existence read happened — no deck update, no link delete.
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('deck_groups');
    });

    it('clears stale group links for an empty groupIds list on a personal deck', async () => {
      const existing = {
        id: 'd-1',
        name: 'Original',
        created_by: ctx.userId,
        visibility: 'personal',
      };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(undefined)); // delete links
      mock.from.mockReturnValueOnce(qb([], null)); // suspended decks
      mock.from.mockReturnValueOnce(qb({ ...existing, groupIds: [] })); // getById

      const result = await service.update('d-1', { groupIds: [] }, ctx);

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      expect(mock.from).toHaveBeenCalledWith('deck_groups');
    });

    it('rejects switching a personal deck to group without a groupIds list', async () => {
      const existing = {
        id: 'd-1',
        name: 'Original',
        created_by: ctx.userId,
        visibility: 'personal',
      };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read

      const result = await service.update('d-1', { visibility: 'group' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('clears group links when a partial PUT switches the deck to personal', async () => {
      const existing = {
        id: 'd-1',
        name: 'Original',
        created_by: ctx.userId,
        visibility: 'group',
      };
      const updated = { ...existing, visibility: 'personal' };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(updated)); // deck update
      mock.from.mockReturnValueOnce(qb([{ id: 'fc-1' }])); // cards of the deck
      mock.from.mockReturnValueOnce(qb(undefined)); // card visibility flip
      mock.from.mockReturnValueOnce(qb(undefined)); // deck_groups delete
      mock.from.mockReturnValueOnce(qb([], null)); // suspended decks
      mock.from.mockReturnValueOnce(qb({ ...updated, groupIds: [] })); // getById

      const result = await service.update('d-1', { visibility: 'personal' }, ctx);

      expect(result.success).toBe(true);
      // No group list was sent, so there is nothing to authorize — the links are just dropped.
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      const linksBuilder = mock.from.mock.results[4].value;
      expect(linksBuilder.delete).toHaveBeenCalled();
      expect(linksBuilder.eq).toHaveBeenCalledWith('deck_id', 'd-1');
      expect(linksBuilder.insert).not.toHaveBeenCalled();
      expect(mock.from.mock.calls.map((c) => c[0])).toEqual([
        'flashcard_decks',
        'flashcard_decks',
        'flashcards',
        'flashcards',
        'deck_groups',
        'suspended_decks',
        'flashcard_decks',
      ]);
      // The deck's cards follow the deck to personal.
      expect(mock.from.mock.results[3].value.update).toHaveBeenCalledWith({
        visibility: 'personal',
      });
    });

    it('ignores a group list sent together with visibility personal', async () => {
      const existing = {
        id: 'd-1',
        name: 'Original',
        created_by: ctx.userId,
        visibility: 'group',
      };
      const updated = { ...existing, visibility: 'personal' };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(updated)); // deck update
      mock.from.mockReturnValueOnce(qb([{ id: 'fc-1' }])); // cards of the deck
      mock.from.mockReturnValueOnce(qb(undefined)); // card visibility flip
      mock.from.mockReturnValueOnce(qb(undefined)); // deck_groups delete
      mock.from.mockReturnValueOnce(qb([], null)); // suspended decks
      mock.from.mockReturnValueOnce(qb({ ...updated, groupIds: [] })); // getById

      const result = await service.update(
        'd-1',
        { visibility: 'personal', groupIds: ['g-1'] },
        { ...ctx, activeOrgId: 'org-1' },
      );

      expect(result.success).toBe(true);
      // Parity with create(): a personal deck never carries group links, so no share guard runs.
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      const linksBuilder = mock.from.mock.results[4].value;
      expect(linksBuilder.delete).toHaveBeenCalled();
      expect(linksBuilder.insert).not.toHaveBeenCalled();
    });

    it('keeps existing links when visibility stays group without a new list', async () => {
      const existing = {
        id: 'd-1',
        name: 'Original',
        created_by: ctx.userId,
        visibility: 'group',
      };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(existing)); // deck update (no-op visibility)
      mock.from.mockReturnValueOnce(qb([], null)); // suspended decks
      mock.from.mockReturnValueOnce(qb({ ...existing, groupIds: ['g-1'] })); // getById

      const result = await service.update('d-1', { visibility: 'group' }, ctx);

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      expect(mock.from).not.toHaveBeenCalledWith('deck_groups');
    });

    it('writes no group links for a name-only update of a shared deck', async () => {
      const existing = {
        id: 'd-1',
        name: 'Original',
        created_by: ctx.userId,
        visibility: 'group',
      };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb({ ...existing, name: 'Renamed' })); // deck update
      mock.from.mockReturnValueOnce(qb([], null)); // suspended decks
      mock.from.mockReturnValueOnce(qb({ ...existing, name: 'Renamed' })); // getById

      const result = await service.update('d-1', { name: 'Renamed' }, ctx);

      expect(result.success).toBe(true);
      expect(mock.from).not.toHaveBeenCalledWith('deck_groups');
    });

    const viewerCtx: RequestContext = {
      ...ctx,
      activeOrgId: 'org-1',
      groupIds: ['g-1'],
      permissionScopes: { 'deck.read': 'group' },
    };
    const sharedDeck = {
      id: 'd-1',
      name: 'Shared',
      created_by: 'teacher-1',
      organization_id: 'org-1',
    };

    it('suspends a readable deck with the deck.read gate, not deck.update', async () => {
      const suspendedDeck = { ...sharedDeck, groupIds: ['g-1'], suspended: true };
      mock.from.mockReturnValueOnce(qb(sharedDeck)); // existence read
      mock.from.mockReturnValueOnce(qb(undefined)); // suspended_decks upsert
      mock.from.mockReturnValueOnce(qb([], null)); // suspended decks
      mock.from.mockReturnValueOnce(qb([{ deck_id: 'd-1' }])); // accessibleFilter group scope: links
      mock.from.mockReturnValueOnce(qb([{ id: 'd-1' }])); // accessibleFilter group scope: deck visibility
      mock.from.mockReturnValueOnce(qb(suspendedDeck)); // getById

      const result = await service.update('d-1', { suspended: true }, viewerCtx);

      expect(result.success).toBe(true);
      expect(vi.mocked(check).mock.calls.map((c) => [c[1], c[2]])).toEqual([
        ['deck.read', sharedDeck],
      ]);
      expect(mock.from.mock.calls.map((c) => c[0])).toEqual([
        'flashcard_decks',
        'suspended_decks',
        'suspended_decks',
        'deck_groups',
        'flashcard_decks',
        'flashcard_decks',
      ]);
      expect(mock.from.mock.results[1].value.upsert).toHaveBeenCalledWith(
        { user_id: viewerCtx.userId, deck_id: 'd-1' },
        { onConflict: 'user_id,deck_id' },
      );
      // A suspend-only body must not reconcile share links (it only reads them for access).
      expect(mock.from.mock.results[3].value.delete).not.toHaveBeenCalled();
    });

    it('unsuspends a readable deck with the deck.read gate, scoped to the caller', async () => {
      const restoredDeck = { ...sharedDeck, groupIds: ['g-1'], suspended: false };
      mock.from.mockReturnValueOnce(qb(sharedDeck)); // existence read
      mock.from.mockReturnValueOnce(qb(undefined)); // suspended_decks delete
      mock.from.mockReturnValueOnce(qb([], null)); // suspended decks
      mock.from.mockReturnValueOnce(qb([{ deck_id: 'd-1' }])); // accessibleFilter group scope: links
      mock.from.mockReturnValueOnce(qb([{ id: 'd-1' }])); // accessibleFilter group scope: deck visibility
      mock.from.mockReturnValueOnce(qb(restoredDeck)); // getById

      const result = await service.update('d-1', { suspended: false }, viewerCtx);

      expect(result.success).toBe(true);
      expect(vi.mocked(check).mock.calls.map((c) => [c[1], c[2]])).toEqual([
        ['deck.read', sharedDeck],
      ]);
      const deleteBuilder = mock.from.mock.results[1].value;
      expect(deleteBuilder.delete).toHaveBeenCalled();
      expect(deleteBuilder.eq).toHaveBeenCalledWith('user_id', viewerCtx.userId);
      expect(deleteBuilder.eq).toHaveBeenCalledWith('deck_id', 'd-1');
    });

    it('keeps the deck.update gate for a mixed body and writes nothing', async () => {
      mock.from.mockReturnValueOnce(qb(sharedDeck)); // existence read
      vi.mocked(check).mockRejectedValueOnce(new AppError('FORBIDDEN'));

      await expect(
        service.update('d-1', { name: 'Hacked', suspended: true }, viewerCtx),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(vi.mocked(check).mock.calls.map((c) => [c[1], c[2]])).toEqual([
        ['deck.update', sharedDeck],
      ]);
      // Only the existence read happened — no deck content write, no suspension row.
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('suspended_decks');
    });

    it('keeps the deck.update gate for a no-op body', async () => {
      mock.from.mockReturnValueOnce(qb(sharedDeck)); // existence read
      mock.from.mockReturnValueOnce(qb([], null)); // suspended decks
      mock.from.mockReturnValueOnce(qb([{ deck_id: 'd-1' }])); // accessibleFilter group scope: links
      mock.from.mockReturnValueOnce(qb([{ id: 'd-1' }])); // accessibleFilter group scope: deck visibility
      mock.from.mockReturnValueOnce(qb({ ...sharedDeck, suspended: false })); // getById

      const result = await service.update('d-1', {}, viewerCtx);

      expect(result.success).toBe(true);
      expect(vi.mocked(check).mock.calls.map((c) => [c[1], c[2]])).toEqual([
        ['deck.update', sharedDeck],
      ]);
    });
  });

  describe('batchToggleSuspend', () => {
    const viewerCtx: RequestContext = {
      ...ctx,
      activeOrgId: 'org-1',
      groupIds: ['g-1'],
      permissionScopes: { 'deck.read': 'group' },
    };
    const deckA = { id: 'd-1', created_by: 'teacher-1', organization_id: 'org-1' };
    const deckB = { id: 'd-2', created_by: 'teacher-1', organization_id: 'org-1' };

    it('checks deck.read once per unique deck, then upserts', async () => {
      mock.from.mockReturnValueOnce(qb([deckA, deckB])); // read guard
      mock.from.mockReturnValueOnce(qb(undefined)); // suspended_decks upsert

      const result = await service.batchToggleSuspend(
        { deckIds: ['d-1', 'd-1', 'd-2'], suspended: true },
        viewerCtx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ updated: 2 });
      expect(vi.mocked(check).mock.calls.map((c) => [c[1], c[2]])).toEqual([
        ['deck.read', deckA],
        ['deck.read', deckB],
      ]);
      expect(mock.from.mock.results[1].value.upsert).toHaveBeenCalledWith(
        [
          { user_id: viewerCtx.userId, deck_id: 'd-1' },
          { user_id: viewerCtx.userId, deck_id: 'd-2' },
        ],
        { onConflict: 'user_id,deck_id', ignoreDuplicates: true },
      );
    });

    it('propagates FORBIDDEN and never touches suspended_decks when a deck is unreadable', async () => {
      mock.from.mockReturnValueOnce(qb([deckA])); // read guard
      vi.mocked(check).mockRejectedValueOnce(new AppError('FORBIDDEN'));

      await expect(
        service.batchToggleSuspend({ deckIds: ['d-1'], suspended: true }, viewerCtx),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(mock.from.mock.calls.map((c) => c[0])).toEqual(['flashcard_decks']);
    });

    it('returns NOT_FOUND and writes nothing for unknown deck ids', async () => {
      mock.from.mockReturnValueOnce(qb([deckA])); // one row for two ids

      const result = await service.batchToggleSuspend(
        { deckIds: ['d-1', 'd-missing'], suspended: true },
        viewerCtx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      expect(mock.from.mock.calls.map((c) => c[0])).toEqual(['flashcard_decks']);
    });

    it('unsuspends with the read guard and deletes rows scoped to the caller', async () => {
      mock.from.mockReturnValueOnce(qb([deckA, deckB])); // read guard
      mock.from.mockReturnValueOnce(qb(undefined)); // suspended_decks delete

      const result = await service.batchToggleSuspend(
        { deckIds: ['d-1', 'd-2'], suspended: false },
        viewerCtx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ updated: 2 });
      const deleteBuilder = mock.from.mock.results[1].value;
      expect(deleteBuilder.delete).toHaveBeenCalled();
      expect(deleteBuilder.eq).toHaveBeenCalledWith('user_id', viewerCtx.userId);
      expect(deleteBuilder.in).toHaveBeenCalledWith('deck_id', ['d-1', 'd-2']);
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
