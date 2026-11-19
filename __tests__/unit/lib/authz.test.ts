import { AccountType, isOrgAdminRole, ORG_ADMIN_ROLE, type RequestContext } from '@studiq/authz';
import {
  accessibleFilter,
  buildQueryFilter,
  can,
  checkPermission,
  evaluate,
  hasPermission,
  requirePermission,
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

    it('defaults students/educators to own for CRUD actions', () => {
      expect(resolveScope(baseCtx, 'flashcard.create')).toBe('own');
      expect(resolveScope(baseCtx, 'deck.delete')).toBe('own');

      // Managers get no implicit CRUD default — only the stored batch applies.
      const manager = { ...baseCtx, accountType: AccountType.MANAGER };
      expect(resolveScope(manager, 'flashcard.create')).toBeNull();
    });

    // ADR-0015 §6.3: inside an org the role's rows are the whole answer, so a
    // member whose role withholds a content key is denied instead of falling
    // back to a persona default the org never granted.
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
    // fail — the student row is the one a "defaults inside an org" branch revives.
    it('denies a student read inside an org whose role has no row for it', () => {
      const inOrg: RequestContext = { ...baseCtx, activeOrgId: 'org-1' };

      expect(resolveScope(inOrg, 'deck.read')).toBeNull();
    });

    it('keeps a stored row inside an org instead of the persona default', () => {
      const inOrg: RequestContext = {
        ...baseCtx,
        activeOrgId: 'org-1',
        permissionScopes: { 'deck.read': 'group' },
      };

      expect(resolveScope(inOrg, 'deck.read')).toBe('group');
      expect(resolveScope(inOrg, 'flashcard.read')).toBeNull();
    });

    it('never gives a group or org key the persona default, with or without an org', () => {
      const inOrg: RequestContext = { ...baseCtx, activeOrgId: 'org-1' };

      for (const key of ['group.read', 'group.invite', 'org.role.manage', 'org.audit.read']) {
        expect(resolveScope(baseCtx, key)).toBeNull();
        expect(resolveScope(inOrg, key)).toBeNull();
      }
    });

    it('returns null for unknown permissions', () => {
      expect(resolveScope(baseCtx, 'role.builder.manage')).toBeNull();
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
    it('produces an own filter for student CRUD defaults', () => {
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
