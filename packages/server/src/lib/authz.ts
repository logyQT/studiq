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
  created_by: string;
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
  }
}

// ── Resource-scoped actions (async — group membership needs DB lookups) ────
export type ResourceType = 'deck' | 'flashcard' | 'question_bank' | 'question' | 'topic';

function resourceTypeFromPermission(permission: string): ResourceType {
  return permission.replace(/\.[^.]+$/, '') as ResourceType;
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

      const joinTable =
        resourceType === 'question_bank' || resourceType === 'question'
          ? 'bank_groups'
          : resourceType === 'deck' || resourceType === 'flashcard'
            ? 'deck_groups'
            : 'topic_groups';

      const resourceFk =
        resourceType === 'question_bank' || resourceType === 'question'
          ? 'bank_id'
          : resourceType === 'deck' || resourceType === 'flashcard'
            ? 'deck_id'
            : 'topic_id';

      const { count } = await supabase
        .from(joinTable)
        .select('*', { count: 'exact', head: true })
        .eq(resourceFk, parentId)
        .in('group_id', ctx.groupIds);

      return (count ?? 0) > 0;
    }
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

async function resolveGroupResourceIds(
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
      return [...new Set((data ?? []).map((r) => r.deck_id as string))];
    }
    case 'flashcard': {
      const { data: decks } = await supabase
        .from('deck_groups')
        .select('deck_id')
        .in('group_id', groupIds);
      const deckIds = [...new Set((decks ?? []).map((r) => r.deck_id as string))];
      if (deckIds.length === 0) return [];
      const { data } = await supabase.from('flashcards').select('id').in('deck_id', deckIds);
      return [...new Set((data ?? []).map((r) => r.id as string))];
    }
    case 'question_bank': {
      const { data } = await supabase
        .from('bank_groups')
        .select('bank_id')
        .in('group_id', groupIds);
      return [...new Set((data ?? []).map((r) => r.bank_id as string))];
    }
    case 'question': {
      const { data: banks } = await supabase
        .from('bank_groups')
        .select('bank_id')
        .in('group_id', groupIds);
      const bankIds = [...new Set((banks ?? []).map((r) => r.bank_id as string))];
      if (bankIds.length === 0) return [];
      const { data } = await supabase.from('questions').select('id').in('bank_id', bankIds);
      return [...new Set((data ?? []).map((r) => r.id as string))];
    }
    case 'topic': {
      const { data } = await supabase
        .from('topic_groups')
        .select('topic_id')
        .in('group_id', groupIds);
      return [...new Set((data ?? []).map((r) => r.topic_id as string))];
    }
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

      const resourceIds = await resolveGroupResourceIds(resourceType, ctx.groupIds);
      if (resourceIds.length === 0) {
        return { organization_id: ctx.activeOrgId, created_by: ctx.userId };
      }

      return {
        organization_id: ctx.activeOrgId,
        or: `created_by.eq.${ctx.userId},id.in.(${resourceIds.join(',')})`,
      };
    }
  }
}
