import { AccountType, type RequestContext } from '@studiq/authz';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { GroupService } from '@studiq/server/services/group.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { firstCall } from '#test/mocks/recorded';

/** Narrows a service result to its data, failing the test when the call failed. */
function expectSuccess<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

vi.mock('@studiq/server/services/limits', () => ({
  limitsResolver: {
    checkLimit: vi.fn().mockResolvedValue(undefined),
    checkOrgLimit: vi.fn().mockResolvedValue(undefined),
  },
}));

type QueryResult = { data: unknown; error: unknown; count?: number };

/** A chainable Supabase query builder stub that is also awaitable. */
type QueryBuilder = {
  select: Mock;
  insert: Mock;
  update: Mock;
  delete: Mock;
  eq: Mock;
  in: Mock;
  order: Mock;
  limit: Mock;
  single: Mock;
  maybeSingle: Mock;
  rpc: Mock;
} & Pick<Promise<QueryResult>, 'then' | 'catch' | 'finally'>;

function qb(data: unknown, error: unknown = null, count?: number): QueryBuilder {
  const result: QueryResult =
    count !== undefined ? { data: data ?? null, count, error } : { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: QueryBuilder = {
    select: vi.fn(() => b),
    insert: vi.fn(() => b),
    update: vi.fn(() => b),
    delete: vi.fn(() => b),
    eq: vi.fn(() => b),
    in: vi.fn(() => b),
    order: vi.fn(() => b),
    limit: vi.fn(() => b),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    rpc: vi.fn(() => b),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return b;
}

/** The row `groupInActiveOrg` reads before any write. */
function groupRow(id = 'g-1', organizationId = 'org-1', createdBy: string | null = null) {
  return { id, organization_id: organizationId, created_by: createdBy };
}

describe('GroupService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: GroupService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.MANAGER,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: 'org-1',
    orgRoleId: null,
    groupIds: [],
    groupRoles: {},
    // The Admin-style rows: every group key at org scope.
    permissionScopes: {
      'group.read': 'organization',
      'group.manage': 'organization',
      'group.member.manage': 'organization',
    },
  };

  /** A role that holds the group keys at `group` scope (the Teacher row). */
  const groupScoped = (groupRoles: Record<string, 'teacher' | 'member'>): RequestContext => ({
    ...ctx,
    accountType: AccountType.EDUCATOR,
    groupRoles,
    permissionScopes: {
      'group.read': 'group',
      'group.manage': 'group',
      'group.member.manage': 'group',
    },
  });

  /** The service-role client `createGroup` enrols the creator with. */
  let enrolment: ReturnType<typeof mockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    enrolment = mockSupabaseClient();
    service = new GroupService(
      () => Promise.resolve(mock),
      () => enrolment,
    );
  });

  describe('listGroups', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.listGroups({ ...ctx, activeOrgId: null });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('lists only the classes the caller created when group.read is own', async () => {
      const data = [
        { id: 'g-created', created_by: 'test-user-id' },
        { id: 'g-foreign', created_by: 'someone-else' },
      ].map((row) => ({
        ...row,
        name: row.id,
        description: null,
        created_at: '2024-01-01',
        group_members: [{ count: 0 }],
        group_members_teachers: [{ count: 0 }],
      }));
      mock.from.mockReturnValueOnce(qb(data));

      const result = await service.listGroups({
        ...ctx,
        permissionScopes: { 'group.read': 'own' },
      });

      expect(expectSuccess(result).map((g) => g.id)).toEqual(['g-created']);
      // `own` alone is a read scope: the row lists, and the editor's
      // `group.manage` check is the separate question of whether it edits.
      expect(expectSuccess(result)[0]?.manageVia).toBeNull();
    });

    it('refuses a role with no group.read at all', async () => {
      const result = await service.listGroups({ ...ctx, permissionScopes: {} });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('returns groups with member/teacher counts', async () => {
      const data = [
        {
          id: 'g-1',
          name: 'Group 1',
          description: 'desc',
          created_at: '2024-01-01',
          created_by: 'someone-else',
          group_members: [{ count: 5 }],
          group_members_teachers: [{ count: 2 }],
        },
      ];
      mock.from.mockReturnValueOnce(qb(data));

      const result = await service.listGroups(ctx);

      expect(expectSuccess(result)).toHaveLength(1);
      expect(expectSuccess(result)[0]?.memberCount).toBe(5);
      expect(expectSuccess(result)[0]?.teacherCount).toBe(2);
    });

    it('marks every group manageable for an organization-scope holder', async () => {
      const data = ['g-1', 'g-2'].map((id) => ({
        id,
        name: id,
        description: null,
        created_at: '2024-01-01',
        created_by: 'someone-else',
        group_members: [{ count: 0 }],
        group_members_teachers: [{ count: 0 }],
      }));
      mock.from.mockReturnValueOnce(qb(data));

      const result = await service.listGroups(ctx);

      expect(expectSuccess(result).every((g) => g.manageVia === 'group.manage')).toBe(true);
    });

    it('marks only the groups a group-scope holder teaches as manageable', async () => {
      const data = [
        { id: 'g-taught', created_by: 'someone-else' },
        { id: 'g-joined', created_by: 'someone-else' },
        { id: 'g-created', created_by: 'test-user-id' },
      ].map((row) => ({
        ...row,
        name: row.id,
        description: null,
        created_at: '2024-01-01',
        group_members: [{ count: 0 }],
        group_members_teachers: [{ count: 0 }],
      }));
      mock.from.mockReturnValueOnce(qb(data));

      const result = await service.listGroups(
        groupScoped({ 'g-taught': 'teacher', 'g-joined': 'member' }),
      );

      expect(expectSuccess(result).find((g) => g.id === 'g-taught')?.manageVia).toBe(
        'group.manage',
      );
      expect(expectSuccess(result).find((g) => g.id === 'g-joined')?.manageVia).toBeNull();
      // Created but not taught: §6.3's `group` scope includes `created_by` for
      // groups, so the owner manages the class they started.
      expect(expectSuccess(result).find((g) => g.id === 'g-created')?.manageVia).toBe(
        'group.manage',
      );
    });

    it('says a roster-only manager gets the members action and not the edit pair', async () => {
      mock.from.mockReturnValueOnce(
        qb(
          [{ id: 'g-taught', created_by: 'someone-else' }].map((row) => ({
            ...row,
            name: row.id,
            description: null,
            created_at: '2024-01-01',
            group_members: [{ count: 0 }],
            group_members_teachers: [{ count: 0 }],
          })),
        ),
      );

      const result = await service.listGroups({
        ...groupScoped({ 'g-taught': 'teacher' }),
        permissionScopes: { 'group.read': 'group', 'group.member.manage': 'group' },
      });

      // `PUT`/`DELETE` would answer 403 for this caller, so the row must not
      // offer them; the roster route checks `group.member.manage` and would not.
      expect(expectSuccess(result)[0]?.manageVia).toBe('group.member.manage');
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
      enrolment.from.mockReturnValueOnce(qb({})); // the creator's teacher row

      const result = await service.createGroup(ctx, { name: 'New Group' });

      expect(expectSuccess(result)).toEqual(group);
    });

    it('enrols the creator as the class’s teacher, so the class it made is manageable', async () => {
      // §10: a class is the teaching surface and `group.manage` at `group` scope
      // needs a `teacher` row. Without this insert the author gets a class whose
      // `manageVia` is `null` and that nobody can ever add them to.
      const group = { id: 'g-1', name: 'New Group', description: null, created_at: 'x' };
      mock.from.mockReturnValueOnce(qb([], null, 0)); // count query
      mock.from.mockReturnValueOnce(qb(group)); // insert
      const enrolBuilder = qb({ group_id: 'g-1', user_id: 'test-user-id', role: 'teacher' });
      enrolment.from.mockReturnValueOnce(enrolBuilder);

      await service.createGroup(ctx, { name: 'New Group' });

      expect(enrolment.from).toHaveBeenCalledWith('group_members');
      expect(enrolBuilder.insert).toHaveBeenCalledWith({
        group_id: 'g-1',
        user_id: 'test-user-id',
        role: 'teacher',
      });
    });

    it('removes the class it just made when the enrolment fails', async () => {
      const group = { id: 'g-1', name: 'New Group', description: null, created_at: 'x' };
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb(group));
      enrolment.from.mockReturnValueOnce(qb(null, { message: 'roster denied' }));
      const rollback = qb([{ id: 'g-1' }]);
      enrolment.from.mockReturnValueOnce(rollback);

      const result = await service.createGroup(ctx, { name: 'New Group' });

      expect(result.success, 'the caller learns the create failed').toBe(false);
      expect(enrolment.from).toHaveBeenLastCalledWith('groups');
      expect(rollback.delete).toHaveBeenCalled();
      expect(rollback.eq).toHaveBeenCalledWith('id', 'g-1');
    });

    it('stores a blank description as null on create', async () => {
      mock.from.mockReturnValueOnce(qb([], null, 0));
      const insertBuilder = qb({
        id: 'g-1',
        name: 'New Group',
        description: null,
        created_at: 'x',
      });
      mock.from.mockReturnValueOnce(insertBuilder);
      enrolment.from.mockReturnValueOnce(qb({}));

      await service.createGroup(ctx, { name: 'New Group', description: '  ' });

      expect(insertBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ description: null }),
      );
    });

    it('returns error on insert failure', async () => {
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.createGroup(ctx, { name: 'New Group' });

      expect(result.success).toBe(false);
    });
  });

  describe('createGroup capability', () => {
    it('lets a role whose group.manage is only group-scoped create (a Teacher)', async () => {
      // §4.3 scopes + §10 classes, decided in 2b-2: both entry points (controller
      // and this repeated service gate) admit any scope, so the service must not
      // refuse the caller the controller just let through.
      mock.from.mockReturnValueOnce(qb([], null, 0)); // count query
      mock.from.mockReturnValueOnce(
        qb({ id: 'g-new', name: 'New Group', description: null, created_at: 'x' }),
      );
      enrolment.from.mockReturnValueOnce(qb({}));

      const result = await service.createGroup(groupScoped({}), { name: 'New Group' });

      expect(expectSuccess(result)).toMatchObject({ id: 'g-new' });
    });

    it('refuses a role with no group.manage at all, before the limit check', async () => {
      const rosterOnly: RequestContext = {
        ...groupScoped({ 'g-mine': 'teacher' }),
        permissionScopes: { 'group.read': 'group', 'group.member.manage': 'group' },
      };

      const result = await service.createGroup(rosterOnly, { name: 'New Group' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).not.toHaveBeenCalled();
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
      mock.from.mockReturnValueOnce(qb(groupRow()));
      mock.from.mockReturnValueOnce(qb(group));

      const result = await service.updateGroup(ctx, 'g-1', { name: 'Updated' });

      expect(expectSuccess(result)).toEqual(group);
    });

    it.each([
      ['null', null],
      ['empty string', ''],
      ['whitespace-only string', '   '],
    ])('clears the description when given %s', async (_label, description) => {
      const builder = qb({ id: 'g-1', name: 'G', description: null, created_at: '2024-01-01' });
      mock.from.mockReturnValueOnce(qb(groupRow()));
      mock.from.mockReturnValueOnce(builder);

      await service.updateGroup(ctx, 'g-1', { description });

      expect(builder.update).toHaveBeenCalledWith({ description: null });
    });

    it('trims a non-empty description', async () => {
      const builder = qb({ id: 'g-1', name: 'G', description: 'x', created_at: '2024-01-01' });
      mock.from.mockReturnValueOnce(qb(groupRow()));
      mock.from.mockReturnValueOnce(builder);

      await service.updateGroup(ctx, 'g-1', { description: '  x  ' });

      expect(builder.update).toHaveBeenCalledWith({ description: 'x' });
    });

    it('leaves the description untouched when the key is absent', async () => {
      const builder = qb({ id: 'g-1', name: 'G', description: 'old', created_at: '2024-01-01' });
      mock.from.mockReturnValueOnce(qb(groupRow()));
      mock.from.mockReturnValueOnce(builder);

      await service.updateGroup(ctx, 'g-1', { name: 'New' });

      expect(builder.update).toHaveBeenCalledWith({ name: 'New' });
      expect(firstCall(builder.update)[0]).not.toHaveProperty('description');
    });

    it('returns NOT_FOUND when the group is not in the active org', async () => {
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.updateGroup(
        { ...ctx, activeOrgId: 'org-2' },
        'group-of-another-org',
        { name: 'Updated' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when group not found', async () => {
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.updateGroup(ctx, 'nonexistent', { name: 'Updated' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow()));
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
      mock.from.mockReturnValueOnce(qb(groupRow()));
      const deleteBuilder = qb([{ id: 'g-1' }]);
      mock.from.mockReturnValueOnce(deleteBuilder);

      const result = await service.deleteGroup(ctx, 'g-1');

      expect(result.success).toBe(true);
      expect(deleteBuilder.select).toHaveBeenCalledWith('id');
    });

    it('returns NOT_FOUND when the group belongs to another org', async () => {
      // Nothing is deleted at all: the group lookup is scoped to the active
      // org, so a foreign id never reaches the DELETE (and RLS alone would not
      // stop it — an org-scope holder is a member of both orgs).
      const lookup = qb(null);
      mock.from.mockReturnValueOnce(lookup);

      const result = await service.deleteGroup(
        { ...ctx, activeOrgId: 'org-2' },
        'group-of-another-org',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      expect(lookup.eq).toHaveBeenCalledWith('organization_id', 'org-2');
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow()));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.deleteGroup(ctx, 'g-1');

      expect(result.success).toBe(false);
      // The DB error must keep its own code instead of collapsing into the
      // empty-projection NOT_FOUND below it.
      if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('group scope authorization', () => {
    it('lets a teacher holding group.manage at group scope update the group they teach', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow('g-taught')));
      mock.from.mockReturnValueOnce(qb({ id: 'g-taught', name: 'Updated' }));

      const result = await service.updateGroup(groupScoped({ 'g-taught': 'teacher' }), 'g-taught', {
        name: 'Updated',
      });

      expect(result.success).toBe(true);
    });

    it('refuses the same teacher on a group they only belong to', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow('g-joined')));

      const result = await service.updateGroup(groupScoped({ 'g-joined': 'member' }), 'g-joined', {
        name: 'Updated',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('refuses a group-scope holder on a group they are not a member of', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow('g-other')));

      const result = await service.deleteGroup(groupScoped({}), 'g-other');

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('lets an own-scope holder delete the group they created, without a membership row', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow('g-mine', 'org-1', 'test-user-id')));
      mock.from.mockReturnValueOnce(qb([{ id: 'g-mine' }]));

      const result = await service.deleteGroup(
        {
          ...groupScoped({}),
          permissionScopes: { 'group.read': 'own', 'group.manage': 'own' },
        },
        'g-mine',
      );

      expect(result.success).toBe(true);
    });

    it('lets a group-scope holder delete the group they created but do not teach', async () => {
      // §6.3 gives the `group` scope one rule that names both halves: "the
      // caller is a `teacher` of the group (or `created_by` for groups)". The
      // owner half is what keeps a class manageable after `setGroupMembers`
      // replaces its roster wholesale — the creator's own `teacher` row is gone
      // while the write that would restore it runs.
      mock.from.mockReturnValueOnce(qb(groupRow('g-mine', 'org-1', 'test-user-id')));
      mock.from.mockReturnValueOnce(qb([{ id: 'g-mine' }]));

      const result = await service.deleteGroup(groupScoped({}), 'g-mine');

      expect(result.success).toBe(true);
    });

    it('refuses a group-scope holder on the group someone else created', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow('g-theirs', 'org-1', 'someone-else')));

      const result = await service.deleteGroup(groupScoped({}), 'g-theirs');

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('refuses a teacher-of-the-group whose role holds no group key at all', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow('g-1')));

      const result = await service.updateGroup(
        { ...groupScoped({ 'g-1': 'teacher' }), permissionScopes: {} },
        'g-1',
        { name: 'Updated' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
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

      expect(expectSuccess(result)).toEqual([{ userId: 'u-1', role: 'teacher' }]);
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
      mock.from.mockReturnValueOnce(qb(groupRow()));
      mock.from.mockReturnValueOnce(qb(undefined)); // delete
      mock.from.mockReturnValueOnce(qb(undefined)); // insert

      const result = await service.setGroupMembers(ctx, 'g-1', {
        members: [{ userId: 'u-1', role: 'teacher' }],
      });

      expect(result.success).toBe(true);
    });

    it('lets the creator rewrite a roster that no longer names them', async () => {
      // The state `setGroupMembers` itself leaves behind: the wholesale replace
      // removed the creator's own `teacher` row, so the `group` scope's teacher
      // half cannot answer and only §6.3's `created_by` half can.
      mock.from.mockReturnValueOnce(qb(groupRow('g-mine', 'org-1', 'test-user-id')));
      mock.from.mockReturnValueOnce(qb(undefined)); // delete
      mock.from.mockReturnValueOnce(qb(undefined)); // insert

      const result = await service.setGroupMembers(groupScoped({}), 'g-mine', {
        members: [{ userId: 'u-1', role: 'member' }],
      });

      expect(result.success).toBe(true);
    });

    it('succeeds with empty members', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow()));
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.setGroupMembers(ctx, 'g-1', { members: [] });

      expect(result.success).toBe(true);
    });

    it('needs group.member.manage, not group.manage', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow('g-taught')));

      const result = await service.setGroupMembers(
        {
          ...groupScoped({ 'g-taught': 'teacher' }),
          permissionScopes: { 'group.manage': 'group' },
        },
        'g-taught',
        { members: [] },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns error on delete failure', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow()));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.setGroupMembers(ctx, 'g-1', { members: [] });

      expect(result.success).toBe(false);
    });

    it('returns error on insert failure', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow()));
      mock.from.mockReturnValueOnce(qb(undefined));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.setGroupMembers(ctx, 'g-1', {
        members: [{ userId: 'u-1', role: 'teacher' }],
      });

      expect(result.success).toBe(false);
    });
  });

  describe('listAddableMembers', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.listAddableMembers({ ...ctx, activeOrgId: null }, 'g-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns FORBIDDEN when the caller cannot manage the group', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow())); // group check

      const result = await service.listAddableMembers(groupScoped({}), 'g-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns org members with role and profile info for an org-scope holder', async () => {
      const data = [
        {
          user_id: 'u-1',
          org_roles: { name: 'admin' },
          profiles: { id: 'u-1', email: 'a@test.com', full_name: 'Alice' },
        },
        {
          user_id: 'u-2',
          org_roles: { name: 'member' },
          profiles: { id: 'u-2', email: 'b@test.com', full_name: null },
        },
      ];
      mock.from.mockReturnValueOnce(qb(groupRow())); // group check
      mock.from.mockReturnValueOnce(qb(data));

      const result = await service.listAddableMembers(ctx, 'g-1');

      expect(expectSuccess(result)).toEqual([
        { id: 'u-1', email: 'a@test.com', fullName: 'Alice', orgRoleName: 'admin' },
        { id: 'u-2', email: 'b@test.com', fullName: null, orgRoleName: 'member' },
      ]);
    });

    it('allows a teacher of the group', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow('g-taught')));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listAddableMembers(
        groupScoped({ 'g-taught': 'teacher' }),
        'g-taught',
      );

      expect(expectSuccess(result)).toEqual([]);
    });

    it('returns NOT_FOUND when the group to authorize does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.listAddableMembers(groupScoped({}), 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(groupRow()));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.listAddableMembers(ctx, 'g-1');

      expect(result.success).toBe(false);
    });
  });

  describe('getUserGroupIds', () => {
    it('returns group IDs from RPC', async () => {
      const builder = qb([{ group_id: 'g-1' }, { group_id: 'g-2' }]);
      mock.rpc.mockReturnValueOnce(builder);

      const result = await service.getUserGroupIds(ctx);

      expect(expectSuccess(result)).toEqual(['g-1', 'g-2']);
    });

    it('returns error on RPC failure', async () => {
      mock.rpc.mockReturnValueOnce(qb(null, { message: 'RPC error' }));

      const result = await service.getUserGroupIds(ctx);

      expect(result.success).toBe(false);
    });

    it('returns empty when data is null', async () => {
      mock.rpc.mockReturnValueOnce(qb(null));

      const result = await service.getUserGroupIds(ctx);

      expect(expectSuccess(result)).toEqual([]);
    });
  });

  describe('isTeacherInGroup', () => {
    it('returns true when user is teacher', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'gm-1' }));

      const result = await service.isTeacherInGroup(ctx, 'g-1');

      expect(expectSuccess(result)).toBe(true);
    });

    it('returns false when user is not teacher', async () => {
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.isTeacherInGroup(ctx, 'g-1');

      expect(expectSuccess(result)).toBe(false);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.isTeacherInGroup(ctx, 'g-1');

      expect(result.success).toBe(false);
    });
  });

  describe('canShareContentToGroups', () => {
    it('allows an empty list without querying', async () => {
      const result = await service.canShareContentToGroups(ctx, [], 'org-1');

      expect(expectSuccess(result)).toBe(true);
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('allows when the caller teaches every requested group', async () => {
      mock.from.mockReturnValueOnce(qb([{ group_id: 'g-1' }, { group_id: 'g-2' }]));

      const result = await service.canShareContentToGroups(ctx, ['g-1', 'g-2'], 'org-1');

      expect(expectSuccess(result)).toBe(true);
    });

    it('scopes the group query to the content org, not the active org', async () => {
      const builder = qb([{ group_id: 'g-1' }]);
      mock.from.mockReturnValueOnce(builder);

      await service.canShareContentToGroups(
        { ...ctx, activeOrgId: 'org-active' },
        ['g-1'],
        'org-content',
      );

      expect(builder.eq).toHaveBeenCalledWith('groups.organization_id', 'org-content');
    });

    it('denies when one of the requested groups is not taught', async () => {
      mock.from.mockReturnValueOnce(qb([{ group_id: 'g-1' }]));

      const result = await service.canShareContentToGroups(ctx, ['g-1', 'g-2'], 'org-1');

      expect(expectSuccess(result)).toBe(false);
    });

    it('denies when the caller teaches none of the requested groups', async () => {
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.canShareContentToGroups(ctx, ['g-1'], 'org-1');

      expect(expectSuccess(result)).toBe(false);
    });

    it('denies a non-empty list when the content has no organization', async () => {
      const result = await service.canShareContentToGroups(ctx, ['g-1'], null);

      expect(expectSuccess(result)).toBe(false);
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('de-duplicates the requested ids before querying', async () => {
      const builder = qb([{ group_id: 'g-1' }]);
      mock.from.mockReturnValueOnce(builder);

      await service.canShareContentToGroups(ctx, ['g-1', 'g-1'], 'org-1');

      expect(builder.in).toHaveBeenCalledWith('group_id', ['g-1']);
    });

    it('fails closed on a DB error', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.canShareContentToGroups(ctx, ['g-1'], 'org-1');

      expect(result.success).toBe(false);
    });
  });

  describe('isUserInGroup', () => {
    it('returns true when user is in group', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'gm-1' }));

      const result = await service.isUserInGroup(ctx, 'g-1');

      expect(expectSuccess(result)).toBe(true);
    });

    it('returns false when user is not in group', async () => {
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.isUserInGroup(ctx, 'g-1');

      expect(expectSuccess(result)).toBe(false);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.isUserInGroup(ctx, 'g-1');

      expect(result.success).toBe(false);
    });
  });

  describe('listMyGroups', () => {
    it('returns the caller groups across their orgs', async () => {
      mock.from.mockReturnValueOnce(qb([{ organization_id: 'org-1' }]));
      mock.from.mockReturnValueOnce(
        qb([
          {
            role: 'teacher',
            joined_at: '2024-01-01',
            groups: { id: 'g-1', name: 'Class 1', organization_id: 'org-1' },
          },
        ]),
      );

      const result = await service.listMyGroups(ctx);

      expect(expectSuccess(result)).toEqual([
        {
          id: 'g-1',
          name: 'Class 1',
          organizationId: 'org-1',
          role: 'teacher',
          joinedAt: '2024-01-01',
        },
      ]);
    });

    it('returns nothing when the caller belongs to no organization', async () => {
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listMyGroups(ctx);

      expect(expectSuccess(result)).toEqual([]);
    });
  });
});
