import { AccountType, type RequestContext } from '@studiq/authz';
import { groupService } from '@studiq/server/services/group.service';
import { TopicService } from '@studiq/server/services/topic.service';
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

describe('TopicService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: TopicService;
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
    service = new TopicService(async () => mock as any);
    vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
      success: true,
      data: true,
    });
  });

  describe('create group sharing', () => {
    it('inserts the topic and its group links when the caller teaches the groups', async () => {
      const topic = { id: 't-1', name: 'Topic', created_by: ctx.userId, visibility: 'group' };
      mock.from.mockReturnValueOnce(qb(topic)); // topics insert
      mock.from.mockReturnValueOnce(qb(undefined)); // topic_groups insert

      const result = await service.create(
        { name: 'Topic', visibility: 'group', groupIds: ['g-1'] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(ctx, ['g-1'], 'org-1');
      const insertCall = mock.from.mock.results[1].value.insert;
      expect(insertCall).toHaveBeenCalledWith([{ topic_id: 't-1', group_id: 'g-1' }]);
    });

    it('returns FORBIDDEN and writes nothing when a group is not taught', async () => {
      vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
        success: true,
        data: false,
      });

      const result = await service.create(
        { name: 'Topic', visibility: 'group', groupIds: ['g-untaugh'] },
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
        { name: 'Topic', visibility: 'group', groupIds: ['g-1'] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('does not run the group guard for an implicit personal topic', async () => {
      const topic = { id: 't-1', name: 'Topic', created_by: ctx.userId, visibility: 'personal' };
      mock.from.mockReturnValueOnce(qb(topic));

      const result = await service.create(
        { name: 'Topic' },
        {
          ...ctx,
          accountType: AccountType.STUDENT,
        },
      );

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
    });
  });

  describe('update group sharing', () => {
    it('returns FORBIDDEN and leaves links untouched when adding an untaught group', async () => {
      const existing = { id: 't-1', name: 'Topic', created_by: ctx.userId, visibility: 'group' };
      mock.from.mockReturnValueOnce(qb(existing));
      vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
        success: true,
        data: false,
      });

      const result = await service.update('t-1', { groupIds: ['g-untaugh'] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(
        ctx,
        ['g-untaugh'],
        'org-1',
      );
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('topic_groups');
    });

    it('rejects a group from another org than the topic, even when the caller teaches it there', async () => {
      const existing = {
        id: 't-1',
        name: 'Topic',
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
        't-1',
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
      expect(mock.from).not.toHaveBeenCalledWith('topic_groups');
    });

    it('falls back to the active org when the topic has no organization', async () => {
      const existing = {
        id: 't-1',
        name: 'Topic',
        created_by: ctx.userId,
        organization_id: null,
        visibility: 'group',
      };
      const linked = { id: 't-1', name: 'Topic', created_by: ctx.userId };
      mock.from.mockReturnValueOnce(qb(existing));
      mock.from.mockReturnValueOnce(qb(undefined));
      mock.from.mockReturnValueOnce(qb(undefined));
      mock.from.mockReturnValueOnce(qb(linked));

      const result = await service.update(
        't-1',
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
        id: 't-1',
        name: 'Topic',
        created_by: ctx.userId,
        organization_id: 'org-1',
        visibility: 'group',
      };
      const linked = { id: 't-1', name: 'Topic', created_by: ctx.userId };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(undefined)); // delete links
      mock.from.mockReturnValueOnce(qb(undefined)); // insert links
      mock.from.mockReturnValueOnce(qb(linked)); // getById

      const result = await service.update('t-1', { groupIds: ['g-1'] }, ctx);

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(ctx, ['g-1'], 'org-1');
      const insertCall = mock.from.mock.results[2].value.insert;
      expect(insertCall).toHaveBeenCalledWith([{ topic_id: 't-1', group_id: 'g-1' }]);
    });

    it('propagates a DB failure while replacing links', async () => {
      const existing = {
        id: 't-1',
        name: 'Topic',
        created_by: ctx.userId,
        organization_id: 'org-1',
        visibility: 'group',
      };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' })); // delete links fails

      const result = await service.update('t-1', { groupIds: ['g-1'] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('clears group links for an empty groupIds list without calling the guard', async () => {
      const existing = { id: 't-1', name: 'Topic', created_by: ctx.userId, visibility: 'group' };
      const cleared = { id: 't-1', name: 'Topic', created_by: ctx.userId };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(undefined)); // delete links
      mock.from.mockReturnValueOnce(qb(cleared)); // getById

      const result = await service.update('t-1', { groupIds: [] }, ctx);

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      expect(mock.from).toHaveBeenCalledWith('topic_groups');
    });
  });

  describe('list filters (#595)', () => {
    it('resolves group ids through topic_groups and narrows the list query', async () => {
      const pageQb = qb([{ id: 't-1', name: 'Topic' }]);
      mock.from.mockReturnValueOnce(pageQb); // topics query builder
      mock.from.mockReturnValueOnce(qb([{ topic_id: 't-1' }])); // topic_groups

      const result = await service.list(ctx, { groups: ['g-1'] } as any);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('topic_groups');
      expect(pageQb.in).toHaveBeenCalledWith('id', ['t-1']);
    });

    it('returns an empty page without running the topic query when no topic matches the groups', async () => {
      const pageQb = qb([]);
      mock.from.mockReturnValueOnce(pageQb); // topics query builder
      mock.from.mockReturnValueOnce(qb([])); // topic_groups → no linked topics

      const result = await service.list(ctx, { groups: ['g-1'] } as any);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ items: [], nextCursor: null, hasMore: false });
      expect(pageQb.in).not.toHaveBeenCalled();
    });

    it('composes owner=mine with the RBAC filter and skips the group lookup', async () => {
      const pageQb = qb([]);
      mock.from.mockReturnValueOnce(pageQb);

      await service.list(ctx, { owner: 'mine' } as any);

      expect(pageQb.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(mock.from).not.toHaveBeenCalledWith('topic_groups');
    });
  });
});
