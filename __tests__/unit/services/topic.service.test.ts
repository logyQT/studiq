import { AccountType, type RequestContext } from '@studiq/authz';
import { groupService } from '@studiq/server/services/group.service';
import { TopicService } from '@studiq/server/services/topic.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/services/group.service', () => ({
  groupService: { canShareContentToGroups: vi.fn() },
}));

type ChainMock = ReturnType<typeof vi.fn>;

/** A thenable PostgREST builder stand-in: every chain method returns itself. */
interface QueryBuilder {
  select: ChainMock;
  insert: ChainMock;
  update: ChainMock;
  delete: ChainMock;
  eq: ChainMock;
  in: ChainMock;
  order: ChainMock;
  limit: ChainMock;
  or: ChainMock;
  ilike: ChainMock;
  single: ChainMock;
  maybeSingle: ChainMock;
  then: ChainMock;
  catch: ChainMock;
  finally: ChainMock;
}

const CHAIN_METHODS = [
  'select',
  'insert',
  'update',
  'delete',
  'eq',
  'in',
  'order',
  'limit',
  'or',
  'ilike',
] as const;

function qb(data: unknown, error: unknown = null, count: number | null = null): QueryBuilder {
  const result = { data: data ?? null, error, count };
  const promise = Promise.resolve(result);
  const builder: QueryBuilder = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    or: vi.fn(),
    ilike: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: vi.fn(),
    catch: vi.fn(),
    finally: vi.fn(),
  };
  for (const method of CHAIN_METHODS) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn().mockResolvedValue(result);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.then = vi.fn(promise.then.bind(promise));
  builder.catch = vi.fn(promise.catch.bind(promise));
  builder.finally = vi.fn(promise.finally.bind(promise));
  return builder;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The first row handed to `insert()`, as recorded on the builder. */
function firstInsert(b: QueryBuilder): Record<string, unknown> {
  const call = b.insert.mock.calls[0];
  if (!Array.isArray(call) || call.length === 0) throw new Error('expected one insert call');
  const row: unknown = call[0];
  if (!isRecord(row)) throw new Error('expected an inserted row object');
  return row;
}

/** A ctx whose `topic.create` scope is `scope` (undefined = no row), persona irrelevant. */
function ctxWithTopicScope(
  scope: 'own' | 'group' | 'organization' | undefined,
  base: RequestContext,
): RequestContext {
  return {
    ...base,
    accountType: AccountType.STUDENT, // persona must not matter
    permissionScopes: scope ? { 'topic.create': scope } : {},
  };
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
    orgRoleId: 'role-1',
    groupIds: [],
    permissionScopes: { 'topic.read': 'own', 'topic.update': 'own' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new TopicService(() => Promise.resolve(mock));
    vi.mocked(groupService.canShareContentToGroups).mockResolvedValue({
      success: true,
      data: true,
    });
  });

  describe('create group sharing', () => {
    it('inserts the topic and its group links when the caller teaches the groups', async () => {
      const topic = { id: 't-1', name: 'Topic', created_by: ctx.userId, visibility: 'group' };
      mock.from.mockReturnValueOnce(qb(topic)); // topics insert
      const insertLinks = qb(undefined); // topic_groups insert
      mock.from.mockReturnValueOnce(insertLinks);

      const result = await service.create(
        { name: 'Topic', visibility: 'group', groupIds: ['g-1'] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(ctx, ['g-1'], 'org-1');
      const insertCall = insertLinks.insert;
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
      const insertQuery = qb(topic);
      mock.from.mockReturnValueOnce(insertQuery);

      const result = await service.create(
        { name: 'Topic' },
        { ...ctx, permissionScopes: { 'topic.create': 'own' } },
      );

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      expect(firstInsert(insertQuery)).toMatchObject({ visibility: 'personal' });
    });
  });

  describe('default visibility from the topic.create scope (not the persona)', () => {
    it('defaults to personal when topic.create is own', async () => {
      const insertQuery = qb({ id: 't-1', name: 'Topic', visibility: 'personal' });
      mock.from.mockReturnValueOnce(insertQuery);

      const result = await service.create({ name: 'Topic' }, ctxWithTopicScope('own', ctx));

      expect(result.success).toBe(true);
      expect(firstInsert(insertQuery)).toMatchObject({ visibility: 'personal' });
    });

    it('defaults to personal when the role holds no topic.create row', async () => {
      const insertQuery = qb({ id: 't-1', name: 'Topic', visibility: 'personal' });
      mock.from.mockReturnValueOnce(insertQuery);

      await service.create({ name: 'Topic' }, ctxWithTopicScope(undefined, ctx));

      expect(firstInsert(insertQuery)).toMatchObject({ visibility: 'personal' });
    });

    it('defaults to group when topic.create is group', async () => {
      const insertQuery = qb({ id: 't-1', name: 'Topic', visibility: 'group' });
      mock.from.mockReturnValueOnce(insertQuery);

      const result = await service.create({ name: 'Topic' }, ctxWithTopicScope('group', ctx));

      expect(result.success).toBe(true);
      expect(firstInsert(insertQuery)).toMatchObject({ visibility: 'group' });
    });

    it('defaults to group when topic.create is organization', async () => {
      const insertQuery = qb({ id: 't-1', name: 'Topic', visibility: 'group' });
      mock.from.mockReturnValueOnce(insertQuery);

      await service.create({ name: 'Topic' }, ctxWithTopicScope('organization', ctx));

      expect(firstInsert(insertQuery)).toMatchObject({ visibility: 'group' });
    });

    it('keeps an explicit personal visibility even at group scope', async () => {
      const insertQuery = qb({ id: 't-1', name: 'Topic', visibility: 'personal' });
      mock.from.mockReturnValueOnce(insertQuery);

      const result = await service.create(
        { name: 'Topic', visibility: 'personal' },
        ctxWithTopicScope('group', ctx),
      );

      expect(result.success).toBe(true);
      expect(firstInsert(insertQuery)).toMatchObject({ visibility: 'personal' });
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
    });

    it('still runs the share check for an explicit group visibility at own scope', async () => {
      const insertQuery = qb({ id: 't-1', name: 'Topic', visibility: 'group' });
      mock.from.mockReturnValueOnce(insertQuery);
      mock.from.mockReturnValueOnce(qb(undefined)); // topic_groups insert

      const result = await service.create(
        { name: 'Topic', visibility: 'group', groupIds: ['g-1'] },
        ctxWithTopicScope('own', ctx),
      );

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(
        ctxWithTopicScope('own', ctx),
        ['g-1'],
        'org-1',
      );
      expect(firstInsert(insertQuery)).toMatchObject({ visibility: 'group' });
    });

    it('applies the same default in bulkCreate (own ⇒ personal, group ⇒ group)', async () => {
      const ownInsert = qb([{ id: 't-1' }, { id: 't-2' }]);
      mock.from.mockReturnValueOnce(ownInsert);

      await service.bulkCreate(
        { topics: [{ name: 'A' }, { name: 'B' }] },
        ctxWithTopicScope('own', ctx),
      );

      expect(firstInsert(ownInsert)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'A', visibility: 'personal' }),
          expect.objectContaining({ name: 'B', visibility: 'personal' }),
        ]),
      );

      mock.from.mockClear();
      const groupInsert = qb([{ id: 't-3' }]);
      mock.from.mockReturnValueOnce(groupInsert);

      await service.bulkCreate({ topics: [{ name: 'C' }] }, ctxWithTopicScope('group', ctx));

      expect(firstInsert(groupInsert)).toEqual([
        expect.objectContaining({ name: 'C', visibility: 'group' }),
      ]);
    });

    it('keeps an explicit per-topic visibility in bulkCreate', async () => {
      const insertQuery = qb([{ id: 't-1' }]);
      mock.from.mockReturnValueOnce(insertQuery);

      await service.bulkCreate(
        { topics: [{ name: 'A', visibility: 'personal' }] },
        ctxWithTopicScope('group', ctx),
      );

      expect(firstInsert(insertQuery)).toEqual([
        expect.objectContaining({ name: 'A', visibility: 'personal' }),
      ]);
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
      const insertLinks = qb(undefined); // insert links
      mock.from.mockReturnValueOnce(insertLinks);
      mock.from.mockReturnValueOnce(qb(linked)); // getById

      const result = await service.update('t-1', { groupIds: ['g-1'] }, ctx);

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(ctx, ['g-1'], 'org-1');
      const insertCall = insertLinks.insert;
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

    it('rejects an empty groupIds list on a group topic and keeps the link', async () => {
      const existing = { id: 't-1', name: 'Topic', created_by: ctx.userId, visibility: 'group' };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read

      const result = await service.update('t-1', { groupIds: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      expect(mock.from).not.toHaveBeenCalledWith('topic_groups');
    });

    it('clears the links when a partial update switches the topic to personal', async () => {
      const existing = {
        id: 't-1',
        name: 'Topic',
        created_by: ctx.userId,
        organization_id: 'org-1',
        visibility: 'group',
      };
      const cleared = {
        id: 't-1',
        name: 'Topic',
        created_by: ctx.userId,
        visibility: 'personal',
        topic_groups: [],
      };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      const updateQuery = qb(existing);
      mock.from.mockReturnValueOnce(updateQuery); // topics update
      const deleteLinks = qb(undefined); // delete links
      mock.from.mockReturnValueOnce(deleteLinks);
      mock.from.mockReturnValueOnce(qb(cleared)); // getById

      const result = await service.update('t-1', { visibility: 'personal' }, ctx);

      expect(result.success).toBe(true);
      expect(updateQuery.update).toHaveBeenCalledWith({ visibility: 'personal' });
      expect(deleteLinks.delete).toHaveBeenCalled();
      expect(deleteLinks.eq).toHaveBeenCalledWith('topic_id', 't-1');
      // Unsharing must not depend on the caller teaching the groups it removes.
      expect(groupService.canShareContentToGroups).not.toHaveBeenCalled();
      expect(result.data).toEqual(
        expect.objectContaining({ visibility: 'personal', groupIds: [] }),
      );
    });

    it('rejects switching a personal topic to group without a list', async () => {
      const existing = { id: 't-1', name: 'Topic', created_by: ctx.userId, visibility: 'personal' };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read

      const result = await service.update('t-1', { visibility: 'group' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('switches a personal topic to group and writes the sent links', async () => {
      const existing = {
        id: 't-1',
        name: 'Topic',
        created_by: ctx.userId,
        organization_id: 'org-1',
        visibility: 'personal',
      };
      const shared = { ...existing, visibility: 'group', topic_groups: [{ group_id: 'g-1' }] };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(existing)); // topics update
      mock.from.mockReturnValueOnce(qb(undefined)); // delete links
      const insertLinks = qb(undefined); // insert links
      mock.from.mockReturnValueOnce(insertLinks);
      mock.from.mockReturnValueOnce(qb(shared)); // getById

      const result = await service.update('t-1', { visibility: 'group', groupIds: ['g-1'] }, ctx);

      expect(result.success).toBe(true);
      expect(groupService.canShareContentToGroups).toHaveBeenCalledWith(ctx, ['g-1'], 'org-1');
      expect(insertLinks.insert).toHaveBeenCalledWith([{ topic_id: 't-1', group_id: 'g-1' }]);
      expect(result.data).toEqual(
        expect.objectContaining({ visibility: 'group', groupIds: ['g-1'] }),
      );
    });

    it('keeps the stored links when the body omits the share fields', async () => {
      const existing = {
        id: 't-1',
        name: 'Topic',
        created_by: ctx.userId,
        organization_id: 'org-1',
        visibility: 'group',
      };
      const read = {
        id: 't-1',
        name: 'Renamed',
        visibility: 'group',
        topic_groups: [{ group_id: 'g-1' }],
      };
      mock.from.mockReturnValueOnce(qb(existing)); // existence read
      mock.from.mockReturnValueOnce(qb(existing)); // topics update
      mock.from.mockReturnValueOnce(qb(read)); // getById

      const result = await service.update('t-1', { name: 'Renamed' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ name: 'Renamed', groupIds: ['g-1'] }));
      expect(mock.from).not.toHaveBeenCalledWith('topic_groups');
    });
  });

  describe('share payload (#1556)', () => {
    it('returns the linked group ids from a single read, in sorted order', async () => {
      const row = {
        id: 't-1',
        name: 'Topic',
        visibility: 'group',
        // PostgREST returns an embed in whatever order it likes.
        topic_groups: [{ group_id: 'g-2' }, { group_id: 'g-1' }],
      };
      mock.from.mockReturnValueOnce(qb(row));

      const result = await service.getById('t-1', ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ groupIds: ['g-1', 'g-2'] }));
    });

    it('returns an empty group id list for a personal topic', async () => {
      mock.from.mockReturnValueOnce(
        qb({ id: 't-1', name: 'Topic', visibility: 'personal', topic_groups: [] }),
      );

      const result = await service.getById('t-1', ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ groupIds: [] }));
    });

    it('returns the linked group ids on each list row', async () => {
      const page = qb([
        {
          id: 't-1',
          name: 'Topic',
          visibility: 'group',
          topic_groups: [{ group_id: 'g-2' }, { group_id: 'g-1' }],
        },
        { id: 't-2', name: 'Personal', visibility: 'personal', topic_groups: [] },
      ]);
      mock.from.mockReturnValueOnce(page);
      mock.from.mockReturnValueOnce(qb(null, null, 2));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({
          items: [
            expect.objectContaining({ id: 't-1', groupIds: ['g-1', 'g-2'] }),
            expect.objectContaining({ id: 't-2', groupIds: [] }),
          ],
        }),
      );
    });
  });

  describe('list filters (#595)', () => {
    it('resolves group ids through topic_groups and narrows the page and its count', async () => {
      const groupQb = qb([{ topic_id: 't-1' }]);
      const sharedQb = qb([{ id: 't-1' }]); // group-visible topics among the linked ones
      const pageQb = qb([{ id: 't-1', name: 'Topic' }]);
      const countQb = qb(null, null, 1);
      mock.from.mockReturnValueOnce(groupQb); // topic_groups
      mock.from.mockReturnValueOnce(sharedQb); // topics visibility
      mock.from.mockReturnValueOnce(pageQb); // list page
      mock.from.mockReturnValueOnce(countQb); // total count

      const result = await service.list(ctx, { groups: ['g-1'] });

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('topic_groups');
      // A stale link row on a personal topic must not widen the group filter.
      expect(sharedQb.eq).toHaveBeenCalledWith('visibility', 'group');
      // Both queries carry the group filter, so `total` matches the visible set.
      expect(pageQb.in).toHaveBeenCalledWith('id', ['t-1']);
      expect(countQb.in).toHaveBeenCalledWith('id', ['t-1']);
    });

    it('returns an empty page with total 0 when no row matches the groups', async () => {
      mock.from.mockReturnValueOnce(qb([])); // topic_groups → no linked rows

      const result = await service.list(ctx, { groups: ['g-1'] });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ items: [], nextCursor: null, hasMore: false, total: 0 });
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    /**
     * An impossible RBAC scope is a filter that cannot match, so it must answer
     * the same empty page as every other non-match — `total` included, or the
     * count line disappears on exactly the path that has nothing to count.
     */
    it('keeps the page shape when the RBAC scope can match nothing', async () => {
      const result = await service.list({
        ...ctx,
        activeOrgId: null,
        permissionScopes: { 'topic.read': 'group' },
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ items: [], nextCursor: null, hasMore: false, total: 0 });
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('composes owner=mine with the RBAC filter and skips the group lookup', async () => {
      const pageQb = qb([]);
      const countQb = qb(null, null, 0);
      mock.from.mockReturnValueOnce(pageQb);
      mock.from.mockReturnValueOnce(countQb);

      await service.list(ctx, { owner: 'mine' });

      expect(pageQb.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(countQb.eq).toHaveBeenCalledWith('created_by', ctx.userId);
      expect(mock.from).not.toHaveBeenCalledWith('topic_groups');
    });
  });
});
