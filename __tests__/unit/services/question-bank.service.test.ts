import { AccountType, type RequestContext } from '@studiq/authz';
import { groupService } from '@studiq/server/services/group.service';
import { QuestionBankService } from '@studiq/server/services/question-bank.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/services/group.service', () => ({
  groupService: { canShareContentToGroups: vi.fn() },
}));

function qb(data: any, error: any = null) {
  const result = { data: data ?? null, error };
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
  b.single = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('QuestionBankService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: QuestionBankService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.EDUCATOR,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: 'org-1',
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new QuestionBankService(async () => mock as any);
    vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
      success: true,
      data: true,
    });
  });

  describe('create group sharing', () => {
    it('inserts the bank and its group links when the caller teaches the groups', async () => {
      const bank = { id: 'b-1', name: 'Bank', created_by: ctx.userId, groupIds: ['g-1'] };
      mock.from.mockReturnValueOnce(qb(bank)); // question_banks insert
      mock.from.mockReturnValueOnce(qb(undefined)); // bank_groups insert
      mock.from.mockReturnValueOnce(qb(bank)); // getById

      const result = await service.create(
        { name: 'Bank', visibility: 'group', groupIds: ['g-1'] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(ctx, ['g-1']);
      const insertCall = mock.from.mock.results[1].value.insert;
      expect(insertCall).toHaveBeenCalledWith([{ bank_id: 'b-1', group_id: 'g-1' }]);
    });

    it('returns FORBIDDEN and writes nothing when a group is not taught', async () => {
      vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
        success: true,
        data: false,
      });

      const result = await service.create(
        { name: 'Bank', visibility: 'group', groupIds: ['g-untaugh'] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('propagates the helper failure code', async () => {
      vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
        success: false,
        error: 'INTERNAL_SERVER',
      });

      const result = await service.create(
        { name: 'Bank', visibility: 'group', groupIds: ['g-1'] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('does not run the group guard for a personal bank', async () => {
      const bank = { id: 'b-1', name: 'Bank', created_by: ctx.userId, groupIds: [] };
      mock.from.mockReturnValueOnce(qb(bank)); // insert
      mock.from.mockReturnValueOnce(qb(bank)); // getById

      const result = await service.create({ name: 'Bank', visibility: 'personal' }, ctx);

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
    });
  });

  describe('update group sharing', () => {
    it('returns FORBIDDEN and leaves links untouched when adding an untaught group', async () => {
      const existing = {
        id: 'b-1',
        name: 'Bank',
        created_by: ctx.userId,
        visibility: 'group',
      };
      mock.from.mockReturnValueOnce(qb(existing));
      vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
        success: true,
        data: false,
      });

      const result = await service.update('b-1', { groupIds: ['g-untaugh'] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(ctx, ['g-untaugh']);
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('bank_groups');
    });

    it('clears group links for an empty groupIds list without calling the guard', async () => {
      const existing = {
        id: 'b-1',
        name: 'Bank',
        created_by: ctx.userId,
        visibility: 'group',
      };
      const cleared = { id: 'b-1', name: 'Bank', created_by: ctx.userId, groupIds: [] };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(undefined)); // delete links
      mock.from.mockReturnValueOnce(qb(cleared)); // getById

      const result = await service.update('b-1', { groupIds: [] }, ctx);

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      expect(mock.from).toHaveBeenCalledWith('bank_groups');
    });
  });
});
