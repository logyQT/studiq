import { describe, expect, it } from 'vitest';
import {
  buildQueryFilter,
  checkPermission,
  evaluate,
  hasPermission,
  resolveScope,
} from '@/lib/authz';
import type { RequestContext } from '@/lib/request-context';
import { AccountType } from '@/types';

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

      const sysadmin = { ...baseCtx, accountType: AccountType.SYS_ADMIN };
      expect(resolveScope(sysadmin, 'flashcard.create')).toBeNull();
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
});
