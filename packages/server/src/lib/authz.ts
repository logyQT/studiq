import {
  AccountType,
  DEFAULT_ROLE_PERMISSIONS,
  evaluateScope,
  Permission,
  type PermissionKey,
  type PermissionScope,
  type RequestContext,
  type ResourceAccess,
} from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { createClient } from '@studiq/server/lib/supabase/server';

export type { PermissionKey, PermissionScope, ResourceAccess };
// ── Re-exports (single frontend + backend surface) ────────────────────────
export { DEFAULT_ROLE_PERMISSIONS, evaluateScope, Permission };

// ── Pure evaluation (client + server) ──────────────────────────────────────
export function evaluate(args: {
  scope: PermissionScope | null | undefined;
  userId: string;
  resource: ResourceAccess;
}): boolean {
  return evaluateScope(args.scope, args.userId, args.resource);
}

// ── Scope resolution ────────────────────────────────────────────────────────
// Resolves a permission's effective scope from the request context ONLY.
// `permissionScopes` is populated by with-auth in a single batched query
// (one SELECT per request), which eliminates the N+1 per-permission
// org_role_permissions lookups the old rbac.getScope() performed.
export function resolveScope(ctx: RequestContext, action: string): PermissionScope | null {
  const stored = ctx.permissionScopes[action];
  if (stored !== undefined) return stored;

  // Students/educators default to 'own' for CRUD actions outside an org role.
  if (ctx.accountType === AccountType.STUDENT || ctx.accountType === AccountType.EDUCATOR) {
    if (
      action.endsWith('.read') ||
      action.endsWith('.create') ||
      action.endsWith('.update') ||
      action.endsWith('.delete')
    ) {
      return 'own';
    }
  }

  return null;
}

// ── Permission checks (server, synchronous — no DB round-trips) ────────────
export function hasPermission(ctx: RequestContext, permission: string): boolean {
  return resolveScope(ctx, permission) !== null;
}

export type Resource = {
  id: string;
  created_by: string | null;
  organization_id: string | null;
};

export function checkPermission(
  ctx: RequestContext,
  permission: string,
  resource: Resource | null,
): void {
  const scope = resolveScope(ctx, permission);
  if (!scope) {
    throw new AppError('FORBIDDEN');
  }

  const passed = evaluate({
    scope,
    userId: ctx.userId,
    resource: {
      createdBy: resource?.created_by ?? '',
      orgId: resource?.organization_id ?? null,
      activeOrgId: ctx.activeOrgId,
    },
  });

  if (!passed) {
    throw new AppError('FORBIDDEN');
  }
}

export type QueryFilter = {
  _impossible?: true;
  _useRpc?: true;
  or?: string;
  organization_id?: string;
  created_by?: string;
};

export function buildQueryFilter(
  ctx: RequestContext,
  permission: string,
  _resourceType?: string,
): QueryFilter {
  const scope = resolveScope(ctx, permission);
  if (!scope) {
    return { _impossible: true };
  }

  switch (scope) {
    case 'any':
      return {};
    case 'organization':
      return ctx.activeOrgId ? { organization_id: ctx.activeOrgId } : { _impossible: true };
    case 'group':
      return ctx.activeOrgId
        ? { _useRpc: true, organization_id: ctx.activeOrgId }
        : { _impossible: true };
    case 'own':
      return ctx.activeOrgId
        ? { created_by: ctx.userId, organization_id: ctx.activeOrgId }
        : { created_by: ctx.userId };
    default:
      return { _impossible: true };
  }
}

// ── Action / context narrowing ────────────────────────────────────────────
const RESOURCE_TYPES = ['deck', 'flashcard', 'question_bank', 'question', 'topic'] as const;

// ── Resource-scoped actions (async — group membership needs DB lookups) ────
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export function isResourceType(value: string): value is ResourceType {
  return (RESOURCE_TYPES as readonly string[]).includes(value);
}

export function isPermissionScope(value: unknown): value is PermissionScope {
  return value === 'own' || value === 'group' || value === 'organization' || value === 'any';
}

export function isAccountType(value: unknown): value is AccountType {
  return (
    value === AccountType.STUDENT || value === AccountType.EDUCATOR || value === AccountType.MANAGER
  );
}

function resourceTypeFromPermission(permission: string): ResourceType | null {
  const candidate = permission.replace(/\.[^.]+$/, '');
  return isResourceType(candidate) ? candidate : null;
}

export async function can(
  ctx: RequestContext,
  action: string,
  resource?: Resource | null,
): Promise<boolean> {
  const scope = resolveScope(ctx, action);
  if (!scope) return false;
  if (!resource) return true;

  switch (scope) {
    case 'any':
      return true;
    case 'organization':
      return ctx.activeOrgId != null && resource.organization_id === ctx.activeOrgId;
    case 'own':
      return resource.created_by === ctx.userId;
    case 'group': {
      if (resource.created_by === ctx.userId) return true;
      if (ctx.groupIds.length === 0) return false;

      const resourceType = resourceTypeFromPermission(action);
      const supabase = await createClient();

      let parentId: string = resource.id;
      if (resourceType === 'flashcard') {
        const { data } = await supabase
          .from('flashcards')
          .select('deck_id')
          .eq('id', resource.id)
          .maybeSingle();
        if (!data) return false;
        parentId = data.deck_id;
      } else if (resourceType === 'question') {
        const { data } = await supabase
          .from('questions')
          .select('bank_id')
          .eq('id', resource.id)
          .maybeSingle();
        if (!data) return false;
        parentId = data.bank_id;
      }

      // A share link only grants group access while the parent deck is still group-visible,
      // so a stale link cannot authorize reads/writes on a deck switched to "personal".
      if (resourceType === 'deck' || resourceType === 'flashcard') {
        if (!parentId) return false;
        const { data: parentDeck } = await supabase
          .from('flashcard_decks')
          .select('visibility')
          .eq('id', parentId)
          .maybeSingle();
        if (parentDeck?.visibility !== 'group') return false;
      }

      // Keep the table and foreign-key names in one branch each: Supabase's typed
      // client cannot resolve a union of table names/filters.
      if (resourceType === 'question_bank' || resourceType === 'question') {
        const { count } = await supabase
          .from('bank_groups')
          .select('*', { count: 'exact', head: true })
          .eq('bank_id', parentId)
          .in('group_id', ctx.groupIds);
        return (count ?? 0) > 0;
      }

      if (resourceType === 'deck' || resourceType === 'flashcard') {
        const { count } = await supabase
          .from('deck_groups')
          .select('*', { count: 'exact', head: true })
          .eq('deck_id', parentId)
          .in('group_id', ctx.groupIds);
        return (count ?? 0) > 0;
      }

      const { count } = await supabase
        .from('topic_groups')
        .select('*', { count: 'exact', head: true })
        .eq('topic_id', parentId)
        .in('group_id', ctx.groupIds);
      return (count ?? 0) > 0;
    }
    default:
      return false;
  }
}

export async function check(
  ctx: RequestContext,
  action: string,
  resource: Resource,
): Promise<void> {
  if (!(await can(ctx, action, resource))) {
    throw new AppError('FORBIDDEN');
  }
}

interface AccessibleFilterResult {
  _impossible?: true;
  or?: string;
  organization_id?: string;
  created_by?: string;
}

export async function resolveGroupResourceIds(
  resourceType: ResourceType,
  groupIds: string[],
): Promise<string[]> {
  const supabase = await createClient();

  switch (resourceType) {
    case 'deck': {
      const { data } = await supabase
        .from('deck_groups')
        .select('deck_id')
        .in('group_id', groupIds);
      const deckIds = [...new Set((data ?? []).map((r) => r.deck_id))];
      if (deckIds.length === 0) return [];
      // A share link only grants access while the deck is actually group-visible; a stale
      // `deck_groups` row left behind by a partial `{ visibility: 'personal' }` PUT must not.
      const { data: sharedDecks } = await supabase
        .from('flashcard_decks')
        .select('id')
        .in('id', deckIds)
        .eq('visibility', 'group');
      return [...new Set((sharedDecks ?? []).map((r) => r.id))];
    }
    case 'question_bank': {
      const { data } = await supabase
        .from('bank_groups')
        .select('bank_id')
        .in('group_id', groupIds);
      return [...new Set((data ?? []).map((r) => r.bank_id))];
    }
    case 'topic': {
      const { data } = await supabase
        .from('topic_groups')
        .select('topic_id')
        .in('group_id', groupIds);
      return [...new Set((data ?? []).map((r) => r.topic_id))];
    }
    default:
      return [];
  }
}

/**
 * The rows of `resourceType` a group share link reaches, as a column of that resource's own
 * table and the parents the column must be in. Cards and questions are reached through their
 * deck and bank, so the filter names those parents: it stays as small as the number of shared
 * decks and banks instead of growing with every card and question inside them (#1049). The
 * filter ends up in the request URL, and PostgREST refuses one beyond ~15 KB (~390 ids).
 */
async function resolveGroupScope(
  resourceType: ResourceType,
  groupIds: string[],
): Promise<{ column: 'id' | 'deck_id' | 'bank_id'; ids: string[] }> {
  switch (resourceType) {
    // A card is readable through a group only when its deck is (same gate as `deck`).
    case 'flashcard':
      return { column: 'deck_id', ids: await resolveGroupResourceIds('deck', groupIds) };
    case 'question':
      return { column: 'bank_id', ids: await resolveGroupResourceIds('question_bank', groupIds) };
    default:
      return { column: 'id', ids: await resolveGroupResourceIds(resourceType, groupIds) };
  }
}

export async function accessibleFilter(
  ctx: RequestContext,
  action: string,
  resourceType: ResourceType,
): Promise<AccessibleFilterResult> {
  const scope = resolveScope(ctx, action);
  if (!scope) return { _impossible: true };

  switch (scope) {
    case 'any':
      return {};
    case 'organization':
      return ctx.activeOrgId ? { organization_id: ctx.activeOrgId } : { _impossible: true };
    case 'own':
      return ctx.activeOrgId
        ? { created_by: ctx.userId, organization_id: ctx.activeOrgId }
        : { created_by: ctx.userId };
    case 'group': {
      if (!ctx.activeOrgId) return { _impossible: true };
      if (ctx.groupIds.length === 0) {
        return { organization_id: ctx.activeOrgId, created_by: ctx.userId };
      }

      const { column, ids } = await resolveGroupScope(resourceType, ctx.groupIds);
      if (ids.length === 0) {
        return { organization_id: ctx.activeOrgId, created_by: ctx.userId };
      }

      return {
        organization_id: ctx.activeOrgId,
        or: `created_by.eq.${ctx.userId},${column}.in.(${ids.join(',')})`,
      };
    }
    default:
      return { _impossible: true };
  }
}
