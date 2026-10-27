import { AccountType, isOrgAdminRole, ORG_ADMIN_ROLE, type RequestContext } from '@studiq/authz';
import {
  accessibleFilter,
  buildQueryFilter,
  can,
  checkPermission,
  evaluate,
  hasPermission,
  resolveScope,
} from '@studiq/server/lib/authz';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function qb(data: any, error: any = null, count?: number) {
  const result =
    count !== undefined ? { data: data ?? null, count, error } : { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: any = {};
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
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

  describe('buildQueryFilter', () => {
    it('produces an own filter for student CRUD defaults', () => {
      expect(buildQueryFilter(baseCtx, 'flashcard.read')).toEqual({
        created_by: 'user-1',
      });
    });

    it('scopes own filters to the active org', () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1' };
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
      expect(evaluate({ scope: null, userId: 'u-1', resource: {} as never })).toBe(false);
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

    it('keeps card access through a group-visible deck', async () => {
      mock.from.mockReturnValueOnce(qb([{ deck_id: 'd-shared' }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'd-shared' }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'fc-1' }]));

      const filter = await accessibleFilter(groupCtx, 'flashcard.read', 'flashcard');

      expect(filter).toEqual({
        organization_id: 'org-1',
        or: 'created_by.eq.user-1,id.in.(fc-1)',
      });
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
