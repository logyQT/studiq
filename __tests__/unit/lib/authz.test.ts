import {
  AccountType,
  isOrgAdminRole,
  ORG_ADMIN_ROLE,
  PERSONAL_PERMISSION_KEYS,
  type PermissionScope,
  type RequestContext,
} from '@studiq/authz';
import {
  accessibleFilter,
  buildQueryFilter,
  can,
  canCreateGroup,
  canGroup,
  checkPermission,
  evaluate,
  hasPermission,
  isGroupPermission,
  requireGroupPermission,
  requirePermission,
  resolveGroupScope,
  resolveScope,
} from '@studiq/server/lib/authz';
import { AppError } from '@studiq/server/lib/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

type ChainMock = ReturnType<typeof vi.fn>;

/** A thenable PostgREST builder stand-in: every chain method returns itself. */
interface QueryBuilder {
  select: ChainMock;
  eq: ChainMock;
  in: ChainMock;
  single: ChainMock;
  maybeSingle: ChainMock;
  then: ChainMock;
  catch: ChainMock;
  finally: ChainMock;
}

const CHAIN_METHODS = ['select', 'eq', 'in'] as const;

function qb(data: unknown, error: unknown = null, count?: number): QueryBuilder {
  const result =
    count !== undefined ? { data: data ?? null, count, error } : { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const builder: QueryBuilder = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
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

const baseCtx: RequestContext = {
  userId: 'user-1',
  accountType: AccountType.STUDENT,
  traceId: 't',
  url: '',
  method: 'GET',
  activeOrgId: null,
  orgRoleId: null,
  groupIds: [],
  permissionScopes: {},
};

/** A `groups` row in `org-1` unless another org is named. */
function groupRow(id: string, organizationId = 'org-1') {
  return { id, organization_id: organizationId };
}

/**
 * A role holding `permission` at `scope` (or at no scope at all) in active org
 * `org-1`, with the given group memberships.
 */
function roleCtx(
  permission: string,
  scope: PermissionScope | null,
  groupRoles: Record<string, 'teacher' | 'member'> = {},
): RequestContext {
  return {
    ...baseCtx,
    accountType: AccountType.EDUCATOR,
    activeOrgId: scope === null ? null : 'org-1',
    groupRoles,
    permissionScopes: scope ? { [permission]: scope } : {},
  };
}

describe('authz (unified lib)', () => {
  describe('resolveScope', () => {
    it('resolves from ctx.permissionScopes (the with-auth batch)', () => {
      const ctx = {
        ...baseCtx,
        permissionScopes: { 'deck.update': 'own' as const, 'flashcard.read': 'any' as const },
      };

      expect(resolveScope(ctx, 'deck.update')).toBe('own');
      expect(resolveScope(ctx, 'flashcard.read')).toBe('any');
    });

    // D35 (register row 3): with no active org the personal-content key set is
    // the whole answer for every persona. A manager is included — authorization
    // reads no account type, and the old persona default did.
    it.each([AccountType.STUDENT, AccountType.EDUCATOR, AccountType.MANAGER])(
      'resolves every personal key at own with no org (%s)',
      (accountType) => {
        const ctx: RequestContext = { ...baseCtx, accountType };

        for (const key of PERSONAL_PERMISSION_KEYS) {
          expect(resolveScope(ctx, key)).toBe('own');
        }
      },
    );

    // The assignment verbs a personal (`organization_id` NULL) row supports are
    // personal; create/publish/grade are not. Named explicitly because the loop
    // above is vacuous if the set shrinks.
    it.each([AccountType.STUDENT, AccountType.EDUCATOR, AccountType.MANAGER])(
      'resolves the personal assignment verbs at own and refuses the rest with no org (%s)',
      (accountType) => {
        const ctx: RequestContext = { ...baseCtx, accountType };

        for (const key of ['assignment.read', 'assignment.update', 'assignment.delete']) {
          expect(resolveScope(ctx, key)).toBe('own');
        }
        for (const key of [
          'assignment.create',
          'assignment.publish',
          'assignment.grade',
          'quiz.read',
        ]) {
          expect(resolveScope(ctx, key)).toBeNull();
        }
      },
    );

    // ADR-0015 §6.3: inside an org the role's rows are the whole answer, so a
    // member whose role withholds a content key is denied instead of falling
    // back to the personal set the org never granted.
    it.each([AccountType.STUDENT, AccountType.EDUCATOR, AccountType.MANAGER])(
      'denies every content key inside an org with no stored row (%s)',
      (accountType) => {
        const inOrg: RequestContext = { ...baseCtx, accountType, activeOrgId: 'org-1' };

        expect(resolveScope(inOrg, 'deck.read')).toBeNull();
        expect(resolveScope(inOrg, 'flashcard.create')).toBeNull();
        expect(resolveScope(inOrg, 'question_bank.update')).toBeNull();
        expect(resolveScope(inOrg, 'quiz.delete')).toBeNull();
      },
    );

    // The table above runs one case per persona; each row alone must be able to
    // fail — removing the in-org deny answers `own` from the personal set for
    // every persona.
    it('denies a student read inside an org whose role has no row for it', () => {
      const inOrg: RequestContext = { ...baseCtx, activeOrgId: 'org-1' };

      expect(resolveScope(inOrg, 'deck.read')).toBeNull();
    });

    it('keeps a stored row inside an org instead of the personal set', () => {
      const inOrg: RequestContext = {
        ...baseCtx,
        activeOrgId: 'org-1',
        permissionScopes: { 'deck.read': 'group' },
      };

      expect(resolveScope(inOrg, 'deck.read')).toBe('group');
      expect(resolveScope(inOrg, 'flashcard.read')).toBeNull();
    });

    // A stored row is returned verbatim, never reconciled with the personal set,
    // and a key without one stays denied inside the org that could have granted
    // it. `deck.read`/`deck.update` are both personal keys, so the set would
    // answer `own` for them here if the stored short-circuit or the in-org null
    // were removed.
    it('returns a stored row as-is and leaves its unrowed sibling null', () => {
      const noOrgEducator: RequestContext = {
        ...baseCtx,
        accountType: AccountType.EDUCATOR,
        permissionScopes: { 'deck.update': 'own' },
      };
      const inOrgEducator: RequestContext = { ...noOrgEducator, activeOrgId: 'org-1' };

      expect(resolveScope(noOrgEducator, 'deck.update')).toBe('own');
      expect(resolveScope(inOrgEducator, 'deck.update')).toBe('own');
      expect(resolveScope(inOrgEducator, 'deck.read')).toBeNull();
    });

    // The stored value is not narrowed to the personal set: a role holding a
    // key at `group` keeps `group` even where the set would answer `own`.
    // A `max(stored, 'own')`, a hard-coded `'own'`, or a `stored ?? default`
    // that ignored the row are all red here.
    it('keeps a stored scope wider than the personal set outside an org', () => {
      const ctx: RequestContext = {
        ...baseCtx,
        accountType: AccountType.EDUCATOR,
        permissionScopes: { 'deck.update': 'group', 'deck.read': 'organization' },
      };

      expect(resolveScope(ctx, 'deck.update')).toBe('group');
      expect(resolveScope(ctx, 'deck.read')).toBe('organization');
    });

    // The set's complement: all of `quiz.*` (quizzes are org rows) and the
    // assignment verbs no personal row supports, plus every group/org key
    // because no personal row can carry one. Inside an org the role rows are
    // the whole answer, so the same keys stay null there.
    it('denies every key outside the personal set, with and without an org', () => {
      const inOrg: RequestContext = { ...baseCtx, activeOrgId: 'org-1' };
      const outside = [
        'quiz.read',
        'quiz.create',
        'assignment.create',
        'assignment.publish',
        'assignment.grade',
        'group.read',
        'group.invite',
        'org.role.manage',
        'org.audit.read',
        'org.member.manage',
      ];

      for (const key of outside) {
        expect(resolveScope(baseCtx, key)).toBeNull();
        expect(resolveScope(inOrg, key)).toBeNull();
        expect(resolveScope({ ...baseCtx, accountType: AccountType.MANAGER }, key)).toBeNull();
      }
    });

    it('decides a read key by the personal set, not by its verb', () => {
      expect(resolveScope(baseCtx, 'flashcard.read')).toBe('own');
      expect(resolveScope(baseCtx, 'assignment.read')).toBe('own');
      for (const key of ['quiz.read', 'group.read', 'org.audit.read']) {
        expect(resolveScope(baseCtx, key)).toBeNull();
      }
    });

    it('returns null for unknown permissions', () => {
      expect(resolveScope(baseCtx, 'role.builder.manage')).toBeNull();
      expect(resolveScope(baseCtx, 'legacy.read')).toBeNull();
    });
  });

  describe('hasPermission', () => {
    it('returns true when scope resolves', () => {
      expect(hasPermission(baseCtx, 'flashcard.read')).toBe(true);
    });

    it('returns false when scope is null', () => {
      expect(hasPermission(baseCtx, 'org_role.manage')).toBe(false);
    });
  });

  describe('requirePermission', () => {
    it('resolves when the caller holds the permission', async () => {
      await expect(
        requirePermission(
          { ...baseCtx, permissionScopes: { 'org.role.manage': 'organization' } },
          'org.role.manage',
        ),
      ).resolves.toBeUndefined();
    });

    it('throws FORBIDDEN when the caller does not hold it', async () => {
      await expect(requirePermission(baseCtx, 'org.role.manage')).rejects.toMatchObject({
        name: 'AppError',
        code: 'FORBIDDEN',
      });
      await expect(requirePermission(baseCtx, 'org.role.manage')).rejects.toBeInstanceOf(AppError);
    });
  });

  describe('buildQueryFilter', () => {
    it('produces an own filter for the personal default', () => {
      expect(buildQueryFilter(baseCtx, 'flashcard.read')).toEqual({
        created_by: 'user-1',
      });
    });

    it('scopes own filters to the active org', () => {
      const ctx = {
        ...baseCtx,
        activeOrgId: 'org-1',
        permissionScopes: { 'flashcard.read': 'own' as const },
      };
      expect(buildQueryFilter(ctx, 'flashcard.read')).toEqual({
        created_by: 'user-1',
        organization_id: 'org-1',
      });
    });

    it('returns an organization filter for org scope', () => {
      const ctx = {
        ...baseCtx,
        activeOrgId: 'org-1',
        permissionScopes: { 'role.builder.manage': 'organization' as const },
      };
      expect(buildQueryFilter(ctx, 'role.builder.manage')).toEqual({ organization_id: 'org-1' });
    });

    it('marks group scope for RPC resolution when in an org', () => {
      const ctx = {
        ...baseCtx,
        activeOrgId: 'org-1',
        permissionScopes: { 'question_bank.read': 'group' as const },
      };
      expect(buildQueryFilter(ctx, 'question_bank.read')).toEqual({
        _useRpc: true,
        organization_id: 'org-1',
      });
    });

    it('marks the filter impossible when scope is null', () => {
      expect(buildQueryFilter(baseCtx, 'org_role.manage')).toEqual({ _impossible: true });
    });
  });

  describe('checkPermission', () => {
    it('passes when the user owns the resource under own scope', () => {
      const ctx = {
        ...baseCtx,
        permissionScopes: { 'deck.update': 'own' as const },
      };

      expect(() =>
        checkPermission(ctx, 'deck.update', {
          id: 'deck-1',
          created_by: 'user-1',
          organization_id: null,
        }),
      ).not.toThrow();
    });

    it('throws FORBIDDEN when scope is missing', () => {
      expect(() => checkPermission(baseCtx, 'org_role.manage', null)).toThrow('FORBIDDEN');
    });

    it('throws FORBIDDEN when the resource is not in scope', () => {
      const ctx = {
        ...baseCtx,
        permissionScopes: { 'deck.update': 'own' as const },
      };

      expect(() =>
        checkPermission(ctx, 'deck.update', {
          id: 'deck-1',
          created_by: 'someone-else',
          organization_id: null,
        }),
      ).toThrow('FORBIDDEN');
    });
  });

  describe('evaluate', () => {
    it('delegates to evaluateScope semantics', () => {
      expect(
        evaluate({
          scope: 'own',
          userId: 'u-1',
          resource: { createdBy: 'u-1', orgId: null, activeOrgId: null },
        }),
      ).toBe(true);
      expect(
        evaluate({
          scope: 'own',
          userId: 'u-1',
          resource: { createdBy: 'u-2', orgId: null, activeOrgId: null },
        }),
      ).toBe(false);
      expect(
        evaluate({
          scope: null,
          userId: 'u-1',
          resource: { createdBy: 'u-1', orgId: null, activeOrgId: null },
        }),
      ).toBe(false);
    });
  });

  describe('group scope and deck share links', () => {
    let mock: ReturnType<typeof mockSupabaseClient>;
    const groupCtx: RequestContext = {
      ...baseCtx,
      activeOrgId: 'org-1',
      groupIds: ['g-1'],
      permissionScopes: { 'deck.read': 'group', 'flashcard.read': 'group' },
    };
    const foreignDeck = { id: 'd-1', created_by: 'teacher-1', organization_id: 'org-1' };

    beforeEach(() => {
      vi.clearAllMocks();
      mock = mockSupabaseClient();
    });

    it('keeps only share links whose deck is group-visible', async () => {
      mock.from.mockReturnValueOnce(qb([{ deck_id: 'd-shared' }, { deck_id: 'd-personal' }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'd-shared' }]));

      const filter = await accessibleFilter(groupCtx, 'deck.read', 'deck');

      expect(filter).toEqual({
        organization_id: 'org-1',
        or: 'created_by.eq.user-1,id.in.(d-shared)',
      });
    });

    it('falls back to own decks when every linked deck is personal', async () => {
      mock.from.mockReturnValueOnce(qb([{ deck_id: 'd-personal' }]));
      mock.from.mockReturnValueOnce(qb([]));

      const filter = await accessibleFilter(groupCtx, 'deck.read', 'deck');

      expect(filter).toEqual({ organization_id: 'org-1', created_by: 'user-1' });
    });

    it('gives no group-derived card access when the owning deck is personal', async () => {
      mock.from.mockReturnValueOnce(qb([{ deck_id: 'd-personal' }]));
      mock.from.mockReturnValueOnce(qb([]));

      const filter = await accessibleFilter(groupCtx, 'flashcard.read', 'flashcard');

      expect(filter).toEqual({ organization_id: 'org-1', created_by: 'user-1' });
    });

    it('keeps card access through a group-visible deck, by deck rather than by card', async () => {
      mock.from.mockReturnValueOnce(qb([{ deck_id: 'd-shared' }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'd-shared' }]));

      const filter = await accessibleFilter(groupCtx, 'flashcard.read', 'flashcard');

      expect(filter).toEqual({
        organization_id: 'org-1',
        or: 'created_by.eq.user-1,deck_id.in.(d-shared)',
      });
      // #1049: the cards of the deck are never listed, so the filter does not grow with them.
      expect(mock.from).not.toHaveBeenCalledWith('flashcards');
    });

    it('keeps question access through a shared bank, by bank rather than by question', async () => {
      mock.from.mockReturnValueOnce(
        qb([{ bank_id: 'b-1' }, { bank_id: 'b-2' }, { bank_id: 'b-1' }]),
      );

      const filter = await accessibleFilter(
        { ...groupCtx, permissionScopes: { 'question.read': 'group' } },
        'question.read',
        'question',
      );

      expect(filter).toEqual({
        organization_id: 'org-1',
        or: 'created_by.eq.user-1,bank_id.in.(b-1,b-2)',
      });
      // #1049: a bank of thousands of questions must not put thousands of ids in the URL.
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('questions');
    });

    it('falls back to own questions when no bank is shared with the group', async () => {
      mock.from.mockReturnValueOnce(qb([]));

      const filter = await accessibleFilter(
        { ...groupCtx, permissionScopes: { 'question.read': 'group' } },
        'question.read',
        'question',
      );

      expect(filter).toEqual({ organization_id: 'org-1', created_by: 'user-1' });
    });

    it('denies group access to a personal deck even when a stale link exists', async () => {
      mock.from.mockReturnValueOnce(qb({ visibility: 'personal' }));

      expect(await can(groupCtx, 'deck.read', foreignDeck)).toBe(false);
      // The join row is never even consulted.
      expect(mock.from).not.toHaveBeenCalledWith('deck_groups');
    });

    it('denies group access to a card of a personal deck', async () => {
      mock.from.mockReturnValueOnce(qb({ deck_id: 'd-1' })); // flashcards → deck_id
      mock.from.mockReturnValueOnce(qb({ visibility: 'personal' })); // deck visibility

      expect(
        await can(groupCtx, 'flashcard.read', {
          id: 'fc-1',
          created_by: 'teacher-1',
          organization_id: 'org-1',
        }),
      ).toBe(false);
      expect(mock.from).not.toHaveBeenCalledWith('deck_groups');
    });

    it('allows group access to a group-visible deck with a matching link', async () => {
      mock.from.mockReturnValueOnce(qb({ visibility: 'group' }));
      mock.from.mockReturnValueOnce(qb(null, null, 1));

      expect(await can(groupCtx, 'deck.read', foreignDeck)).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('deck_groups');
    });
  });

  describe('group permission scope (ADR-0015 §4.3, §6.3)', () => {
    it('recognises exactly the four group keys', () => {
      expect(
        ['group.read', 'group.manage', 'group.member.manage', 'group.invite'].filter(
          isGroupPermission,
        ),
      ).toHaveLength(4);
      expect(isGroupPermission('deck.read')).toBe(false);
      expect(isGroupPermission('org.role.manage')).toBe(false);
    });

    // The create rule (§4.3 scopes, §10 classes; the 2b-2 decision that a Teacher
    // may create a class): any scope the role holds the key at authorizes it,
    // because the creator becomes the class's teacher.
    it('lets a group-scope group.manage create a class', () => {
      expect(canCreateGroup(roleCtx('group.manage', 'group'))).toBe(true);
    });

    it('lets an own-scope group.manage create a class', () => {
      // A create cannot wait for an existing row, so the scope the created row
      // would resolve at must not be the thing that withholds it.
      expect(canCreateGroup(roleCtx('group.manage', 'own'))).toBe(true);
    });

    it('lets an organization-scope group.manage create a class (an Admin)', () => {
      expect(canCreateGroup(roleCtx('group.manage', 'organization'))).toBe(true);
    });

    it('refuses a create to a role with no group.manage at any scope', () => {
      const rosterOnly: RequestContext = {
        ...baseCtx,
        accountType: AccountType.EDUCATOR,
        activeOrgId: 'org-1',
        permissionScopes: { 'group.read': 'group', 'group.member.manage': 'group' },
        groupRoles: { 'g-mine': 'teacher' },
      };
      expect(canCreateGroup(rosterOnly)).toBe(false);
    });

    it('refuses a create with no active org even when the role holds group.manage', () => {
      const ctx: RequestContext = {
        ...baseCtx,
        accountType: AccountType.EDUCATOR,
        permissionScopes: { 'group.manage': 'organization' },
      };
      expect(canCreateGroup(ctx)).toBe(false);
    });

    it('refuses a key outside the group family even when the role holds it org-wide', () => {
      // Without the `isGroupPermission` guard this resolves `true` from the
      // `organization` branch, i.e. a content key would authorize a group.
      expect(resolveGroupScope(roleCtx('deck.read', 'organization'), 'deck.read', 'g-1')).toBe(
        false,
      );
    });

    it('lets an organization-scope holder manage any group in the active org', () => {
      expect(
        resolveGroupScope(roleCtx('group.manage', 'organization'), 'group.manage', 'g-any'),
      ).toBe(true);
    });

    it('lets a teacher of the group manage that group', () => {
      expect(
        resolveGroupScope(
          roleCtx('group.manage', 'group', { 'g-mine': 'teacher' }),
          'group.manage',
          'g-mine',
        ),
      ).toBe(true);
    });

    it('refuses a group-scope role on a group it only belongs to', () => {
      expect(
        resolveGroupScope(
          roleCtx('group.manage', 'group', { 'g-joined': 'member' }),
          'group.manage',
          'g-joined',
        ),
      ).toBe(false);
    });

    it('refuses a teacher of the group whose role withholds the key', () => {
      // Teaching is not authority: the ADR's `group` scope means "AND the caller
      // is a teacher", not "a teacher may do anything in their class".
      expect(resolveGroupScope(roleCtx('group.manage', null), 'group.manage', 'g-mine')).toBe(
        false,
      );
    });

    it('refuses a teacher of a group outside the active org', () => {
      // Only the org differs from the green case above: the SAME caller, teaching
      // the SAME id, with `activeOrgId` unset. An empty `groupRoles` (the old
      // fixture) passes this even if the `group` branch stops reading the org.
      // A stored scope outlives the cookie that selected the org, so the context
      // still HELDS the key and names the membership — only the org is missing.
      const teacher: RequestContext = {
        ...baseCtx,
        accountType: AccountType.EDUCATOR,
        activeOrgId: null,
        groupRoles: { 'g-foreign': 'teacher' },
        permissionScopes: { 'group.manage': 'group' },
      };
      expect(resolveGroupScope(teacher, 'group.manage', 'g-foreign')).toBe(false);
      expect(
        resolveGroupScope({ ...teacher, activeOrgId: 'org-1' }, 'group.manage', 'g-foreign'),
      ).toBe(true);
    });

    it('authorizes nothing at all without an active org', () => {
      const ctx: RequestContext = {
        ...baseCtx,
        accountType: AccountType.EDUCATOR,
        permissionScopes: { 'group.manage': 'organization' },
      };
      expect(resolveGroupScope(ctx, 'group.manage', 'g')).toBe(false);
    });

    it('gives an own row the group the caller created through canGroup', () => {
      expect(
        canGroup(roleCtx('group.manage', 'own'), 'group.manage', {
          ...groupRow('g-new'),
          created_by: 'user-1',
        }),
      ).toBe(true);
    });

    it('refuses an own row on a group someone else created through canGroup', () => {
      expect(
        canGroup(roleCtx('group.manage', 'own'), 'group.manage', {
          ...groupRow('g-theirs'),
          created_by: 'user-2',
        }),
      ).toBe(false);
    });

    it('refuses a group.invite row held at own scope, which the catalog does not allow', () => {
      // `group.invite` is the one group key with no `own` scope (ADR-0015 §4.1),
      // so a hand-written `own` row must not reach a group the caller created.
      const ctx: RequestContext = {
        ...baseCtx,
        accountType: AccountType.EDUCATOR,
        activeOrgId: 'org-1',
        // `group.manage` rather than `group.invite`: the former's catalogue row
        // LISTS `own`, so only the creator comparison can refuse it here.
        permissionScopes: { 'group.manage': 'own' },
      };
      expect(resolveGroupScope(ctx, 'group.manage', 'g-created', { created_by: 'user-2' })).toBe(
        false,
      );
      expect(resolveGroupScope(ctx, 'group.invite', 'g-created', { created_by: 'user-1' })).toBe(
        false,
      );
      expect(
        resolveGroupScope(
          { ...ctx, permissionScopes: { 'group.manage': 'own' } },
          'group.manage',
          'g-created',
          { created_by: 'user-1' },
        ),
      ).toBe(true);
    });

    it('refuses a non-group permission outright instead of widening it to the org', () => {
      expect(() =>
        requireGroupPermission(roleCtx('deck.read', 'organization'), 'deck.read', groupRow('g-1')),
      ).toThrow(AppError);
    });

    it('refuses a group of another org even when the role holds the key org-wide', () => {
      expect(
        canGroup(roleCtx('group.manage', 'organization'), 'group.manage', groupRow('g-x', 'org-2')),
      ).toBe(false);
    });

    it('resolves for a teacher of the group through requireGroupPermission', () => {
      expect(() =>
        requireGroupPermission(
          roleCtx('group.member.manage', 'group', { 'g-mine': 'teacher' }),
          'group.member.manage',
          groupRow('g-mine'),
        ),
      ).not.toThrow();
    });

    it('throws FORBIDDEN for a member of the group through requireGroupPermission', () => {
      expect(() =>
        requireGroupPermission(
          roleCtx('group.member.manage', 'group', { 'g-joined': 'member' }),
          'group.member.manage',
          groupRow('g-joined'),
        ),
      ).toThrow(AppError);
    });
  });
});

describe('isOrgAdminRole', () => {
  it('accepts only the exact admin role name', () => {
    expect(isOrgAdminRole(ORG_ADMIN_ROLE)).toBe(true);
    expect(isOrgAdminRole('admin')).toBe(true);
  });

  it('rejects every other value', () => {
    for (const role of ['Admin', 'teacher', 'member', '', null, undefined]) {
      expect(isOrgAdminRole(role)).toBe(false);
    }
  });

  it('pins the token to the database role name', () => {
    expect(ORG_ADMIN_ROLE).toBe('admin');
  });
});
