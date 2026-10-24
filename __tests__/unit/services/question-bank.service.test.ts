import { AccountType, type RequestContext } from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { groupService } from '@studiq/server/services/group.service';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import { QuestionBankService } from '@studiq/server/services/question-bank.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

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
      mock.from.mockReturnValueOnce(qb(null, null, 0)); // limit count
      const insertBuilder = qb(bank); // question_banks insert
      mock.from.mockReturnValueOnce(insertBuilder);
      const linksBuilder = qb(undefined); // bank_groups insert
      mock.from.mockReturnValueOnce(linksBuilder);
      mock.from.mockReturnValueOnce(qb(bank)); // getById

      const result = await service.create(
        { name: 'Bank', visibility: 'group', groupIds: ['g-1'] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(ctx, ['g-1'], 'org-1');
      expect(limitsResolver.checkLimit).toHaveBeenCalledWith(ctx, 'max_question_banks', 0);
      expect(linksBuilder.insert).toHaveBeenCalledWith([{ bank_id: 'b-1', group_id: 'g-1' }]);
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
      mock.from.mockReturnValueOnce(qb(null, null, 0)); // limit count
      mock.from.mockReturnValueOnce(qb(bank)); // insert
      mock.from.mockReturnValueOnce(qb(bank)); // getById

      const result = await service.create({ name: 'Bank', visibility: 'personal' }, ctx);

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
    });
  });

  describe('max_question_banks limit', () => {
    it('checks the caller bank count against max_question_banks before inserting', async () => {
      const countBuilder = qb(null, null, 3);
      mock.from.mockReturnValueOnce(countBuilder);
      mock.from.mockReturnValueOnce(qb({ id: 'b-1' }));
      mock.from.mockReturnValueOnce(qb({ id: 'b-1' }));

      const result = await service.create({ name: 'Bank' }, ctx);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('question_banks');
      expect(countBuilder.select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
      expect(countBuilder.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(limitsResolver.checkLimit).toHaveBeenCalledWith(ctx, 'max_question_banks', 3);
    });

    it('rejects with USAGE_LIMIT_EXCEEDED and does not insert when over the limit', async () => {
      const countBuilder = qb(null, null, 5);
      mock.from.mockReturnValueOnce(countBuilder);
      vi.mocked(limitsResolver.checkLimit).mockRejectedValueOnce(
        new AppError('USAGE_LIMIT_EXCEEDED'),
      );

      await expect(service.create({ name: 'Bank' }, ctx)).rejects.toThrow(AppError);

      expect(limitsResolver.checkLimit).toHaveBeenCalledWith(ctx, 'max_question_banks', 5);
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(countBuilder.insert).not.toHaveBeenCalled();
    });

    it('bulkCreate checks the batch size against max_question_banks', async () => {
      mock.from.mockReturnValueOnce(qb(null, null, 1));
      mock.from.mockReturnValueOnce(qb([{ id: 'b-1' }, { id: 'b-2' }]));

      const result = await service.bulkCreate({ banks: [{ name: 'A' }, { name: 'B' }] }, ctx);

      expect(result.success).toBe(true);
      expect(limitsResolver.checkLimit).toHaveBeenCalledWith(ctx, 'max_question_banks', 1, 2);
    });

    it('bulkCreate rejects before inserting when the batch would exceed the limit', async () => {
      const countBuilder = qb(null, null, 4);
      mock.from.mockReturnValueOnce(countBuilder);
      vi.mocked(limitsResolver.checkLimit).mockRejectedValueOnce(
        new AppError('USAGE_LIMIT_EXCEEDED'),
      );

      await expect(
        service.bulkCreate({ banks: [{ name: 'A' }, { name: 'B' }] }, ctx),
      ).rejects.toThrow(AppError);

      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(countBuilder.insert).not.toHaveBeenCalled();
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
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(
        ctx,
        ['g-untaugh'],
        'org-1',
      );
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('bank_groups');
    });

    it('rejects a group from another org than the bank, even when the caller teaches it there', async () => {
      const existing = {
        id: 'b-1',
        name: 'Bank',
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
        'b-1',
        { groupIds: ['g-in-B'] },
        { ...ctx, activeOrgId: 'org-B' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(
        { ...ctx, activeOrgId: 'org-B' },
        ['g-in-B'],
        'org-A',
      );
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('bank_groups');
    });

    it('falls back to the active org when the bank has no organization', async () => {
      const existing = {
        id: 'b-1',
        name: 'Bank',
        created_by: ctx.userId,
        organization_id: null,
        visibility: 'group',
      };
      const linked = { id: 'b-1', name: 'Bank', created_by: ctx.userId, groupIds: ['g-1'] };
      mock.from.mockReturnValueOnce(qb(existing));
      mock.from.mockReturnValueOnce(qb(undefined));
      mock.from.mockReturnValueOnce(qb(undefined));
      mock.from.mockReturnValueOnce(qb(linked));

      const result = await service.update(
        'b-1',
        { groupIds: ['g-1'] },
        { ...ctx, activeOrgId: 'org-B' },
      );

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(
        { ...ctx, activeOrgId: 'org-B' },
        ['g-1'],
        'org-B',
      );
    });

    it('replaces group links when every requested group is taught', async () => {
      const existing = {
        id: 'b-1',
        name: 'Bank',
        created_by: ctx.userId,
        organization_id: 'org-1',
        visibility: 'group',
      };
      const linked = { id: 'b-1', name: 'Bank', created_by: ctx.userId, groupIds: ['g-1'] };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(undefined)); // delete links
      mock.from.mockReturnValueOnce(qb(undefined)); // insert links
      mock.from.mockReturnValueOnce(qb(linked)); // getById

      const result = await service.update('b-1', { groupIds: ['g-1'] }, ctx);

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(ctx, ['g-1'], 'org-1');
      const insertCall = mock.from.mock.results[2].value.insert;
      expect(insertCall).toHaveBeenCalledWith([{ bank_id: 'b-1', group_id: 'g-1' }]);
    });

    it('propagates a DB failure while replacing links', async () => {
      const existing = {
        id: 'b-1',
        name: 'Bank',
        created_by: ctx.userId,
        organization_id: 'org-1',
        visibility: 'group',
      };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' })); // delete links fails

      const result = await service.update('b-1', { groupIds: ['g-1'] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
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
