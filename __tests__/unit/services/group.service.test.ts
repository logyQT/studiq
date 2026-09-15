import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import type { RequestContext } from '@/lib/request-context';
import { GroupService } from '@/server/services/group.service';

vi.mock('@/server/services/limits.resolver', () => ({
  limitsResolver: {
    checkLimit: vi.fn().mockResolvedValue(undefined),
    checkOrgLimit: vi.fn().mockResolvedValue(undefined),
  },
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
  b.single = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.rpc = vi.fn(() => b);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('GroupService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: GroupService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: 'educator' as any,
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
    service = new GroupService(async () => mock as any);
  });

  describe('listGroups', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.listGroups({ ...ctx, activeOrgId: null });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns groups with member/teacher counts', async () => {
      const data = [
        {
          id: 'g-1',
          name: 'Group 1',
          description: 'desc',
          created_at: '2024-01-01',
          group_members: [{ count: 5 }],
          group_members_teachers: [{ count: 2 }],
        },
      ];
      mock.from.mockReturnValueOnce(qb(data));

      const result = await service.listGroups(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].memberCount).toBe(5);
      expect(result.data[0].teacherCount).toBe(2);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.listGroups(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('createGroup', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.createGroup({ ...ctx, activeOrgId: null }, { name: 'Group' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('creates a group', async () => {
      const group = { id: 'g-1', name: 'New Group', description: null, created_at: '2024-01-01' };
      mock.from.mockReturnValueOnce(qb([], null, 0)); // count query
      mock.from.mockReturnValueOnce(qb(group)); // insert

      const result = await service.createGroup(ctx, { name: 'New Group' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(group);
    });

    it('returns error on insert failure', async () => {
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.createGroup(ctx, { name: 'New Group' });

      expect(result.success).toBe(false);
    });
  });

  describe('updateGroup', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.updateGroup({ ...ctx, activeOrgId: null }, 'g-1', {
        name: 'Updated',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('updates a group', async () => {
      const group = { id: 'g-1', name: 'Updated', description: null, created_at: '2024-01-01' };
      mock.from.mockReturnValueOnce(qb(group));

      const result = await service.updateGroup(ctx, 'g-1', { name: 'Updated' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(group);
    });

    it('returns NOT_FOUND when group not found', async () => {
      mock.from.mockReturnValueOnce(qb(null, { code: 'PGRST116' }));

      const result = await service.updateGroup(ctx, 'nonexistent', { name: 'Updated' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.updateGroup(ctx, 'g-1', { name: 'Updated' });

      expect(result.success).toBe(false);
    });
  });

  describe('deleteGroup', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.deleteGroup({ ...ctx, activeOrgId: null }, 'g-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('deletes a group', async () => {
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.deleteGroup(ctx, 'g-1');

      expect(result.success).toBe(true);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.deleteGroup(ctx, 'g-1');

      expect(result.success).toBe(false);
    });
  });

  describe('getGroupMembers', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.getGroupMembers({ ...ctx, activeOrgId: null }, 'g-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns NOT_FOUND when group does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getGroupMembers(ctx, 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns members', async () => {
      const members = [{ user_id: 'u-1', role: 'teacher' }];
      mock.from.mockReturnValueOnce(qb({ id: 'g-1' }));
      mock.from.mockReturnValueOnce(qb(members));

      const result = await service.getGroupMembers(ctx, 'g-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([{ userId: 'u-1', role: 'teacher' }]);
    });

    it('returns error on members query failure', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'g-1' }));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.getGroupMembers(ctx, 'g-1');

      expect(result.success).toBe(false);
    });
  });

  describe('setGroupMembers', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.setGroupMembers({ ...ctx, activeOrgId: null }, 'g-1', {
        members: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns NOT_FOUND when group does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.setGroupMembers(ctx, 'nonexistent', { members: [] });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('deletes and re-inserts members', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'g-1' })); // group check
      mock.from.mockReturnValueOnce(qb(undefined)); // delete
      mock.from.mockReturnValueOnce(qb(undefined)); // insert

      const result = await service.setGroupMembers(ctx, 'g-1', {
        members: [{ userId: 'u-1', role: 'teacher' }],
      });

      expect(result.success).toBe(true);
    });

    it('succeeds with empty members', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'g-1' }));
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.setGroupMembers(ctx, 'g-1', { members: [] });

      expect(result.success).toBe(true);
    });

    it('returns error on delete failure', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'g-1' }));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.setGroupMembers(ctx, 'g-1', { members: [] });

      expect(result.success).toBe(false);
    });

    it('returns error on insert failure', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'g-1' }));
      mock.from.mockReturnValueOnce(qb(undefined));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.setGroupMembers(ctx, 'g-1', {
        members: [{ userId: 'u-1', role: 'teacher' }],
      });

      expect(result.success).toBe(false);
    });
  });

  describe('getUserGroupIds', () => {
    it('returns group IDs from RPC', async () => {
      mock.rpc.mockResolvedValueOnce({
        data: [{ group_id: 'g-1' }, { group_id: 'g-2' }],
        error: null,
      });

      const result = await service.getUserGroupIds(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(['g-1', 'g-2']);
    });

    it('returns error on RPC failure', async () => {
      mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'RPC error' } });

      const result = await service.getUserGroupIds(ctx);

      expect(result.success).toBe(false);
    });

    it('returns empty when data is null', async () => {
      mock.rpc.mockResolvedValueOnce({ data: null, error: null });

      const result = await service.getUserGroupIds(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('isTeacherInGroup', () => {
    it('returns true when user is teacher', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'm-1' }));

      const result = await service.isTeacherInGroup(ctx, 'g-1');

      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('returns false when user is not teacher', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.isTeacherInGroup(ctx, 'g-1');

      expect(result.success).toBe(true);
      expect(result.data).toBe(false);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.isTeacherInGroup(ctx, 'g-1');

      expect(result.success).toBe(false);
    });
  });

  describe('isUserInGroup', () => {
    it('returns true when user is in group', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'm-1' }));

      const result = await service.isUserInGroup(ctx, 'g-1');

      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('returns false when user is not in group', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.isUserInGroup(ctx, 'g-1');

      expect(result.success).toBe(true);
      expect(result.data).toBe(false);
    });
  });

  describe('listMyGroups', () => {
    it('returns user groups', async () => {
      const data = [
        {
          role: 'teacher',
          joined_at: '2024-01-01',
          groups: { id: 'g-1', name: 'Group 1', organization_id: 'org-1' },
        },
      ];
      mock.from.mockReturnValueOnce(qb(data));

      const result = await service.listMyGroups(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('g-1');
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.listMyGroups(ctx);

      expect(result.success).toBe(false);
    });
  });
});
