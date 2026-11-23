import {
  AccountType,
  evaluateScope,
  isPermissionCatalogKey,
  isPersonalPermissionKey,
  PERMISSIONS,
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
export { evaluateScope, Permission };

// ── Pure evaluation (client + server) ──────────────────────────────────────
export function evaluate(args: {
  scope: PermissionScope | null | undefined;
  userId: string;
  resource: ResourceAccess;
}): boolean {
  return evaluateScope(args.scope, args.userId, args.resource);
}

/**
 * Resolves a permission's effective scope from the request context ONLY.
 * `permissionScopes` is populated by with-auth in a single batched query
 * (one SELECT per request), which eliminates the N+1 per-permission
 * org_role_permissions lookups the old rbac.getScope() performed.
 *
 * Inside an active org the stored role row is the whole answer (ADR-0015 §6.3:
 * no row → deny). Outside every org there is no role to read, so the
 * personal-content key set resolves at `own` for any authenticated caller:
 * persona decides nothing here (D35). The set carries the three assignment verbs
 * a personal (NULL-org) row supports; `quiz.*` and `assignment.create` are
 * absent because their services refuse a no-org call, and `assignment.publish`/
 * `grade` because the persona default this set replaces never granted them.
 */
export function resolveScope(ctx: RequestContext, action: string): PermissionScope | null {
  const stored = ctx.permissionScopes[action];
  if (stored !== undefined) return stored;

  if (ctx.activeOrgId != null) return null;

  return isPersonalPermissionKey(action) ? 'own' : null;
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
  return value === 'own' || value === 'group' || value === 'organization';
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

/**
 * A capability the caller must hold to reach a write path (ADR-0015 §4.4).
 * Throws instead of returning a boolean so a controller cannot forget the
 * branch; `withAuth` maps the throw to 403 and records it on the span.
 */
export async function requirePermission(ctx: RequestContext, permission: string): Promise<void> {
  if (!(await can(ctx, permission))) {
    throw new AppError('FORBIDDEN');
  }
}

// ── Group scope (ADR-0015 §4.3, §6.3, §10) ────────────────────────────────
const GROUP_PERMISSIONS = [
  'group.read',
  'group.manage',
  'group.member.manage',
  'group.invite',
] as const;

export function isGroupPermission(permission: string): boolean {
  return (GROUP_PERMISSIONS as readonly string[]).includes(permission);
}

/**
 * The caller's authority over ONE group, from the request context alone
 * (`permissionScopes` and `groupRoles`, both resolved for the active org).
 *
 * - `organization`: the role holds the key at org scope, which reaches every
 *   group of the active org (ADR-0015 §6.3).
 * - `group`: the caller is a `teacher` of THIS group (§4.3) **or its creator**
 *   (§4.3: `group` manage/invite → "the caller is a `teacher`/owner of the
 *   group"), so the role must also hold the key at group scope. The owner
 *   belongs here, and not only in `own`, because the seeded Teacher row carries
 *   the keys at `group` and never at `own` — and because `setGroupMembers`
 *   replaces a roster wholesale, so the creator's own `teacher` row is absent
 *   exactly while the write that would restore it runs. Without the owner half
 *   a creator could never write back a roster they had just cleared.
 * - `own`: the caller created the group (§4.3: `groups.created_by = caller`),
 *   and only for a key whose catalog row lists `own`. `group.invite` does not
 *   (ADR-0015 §4.1), so an `own` invite row authorizes nothing. A `group`-scope
 *   row does not reach it either: §6.3 gives each scope exactly one rule.
 *
 * No active org authorizes nothing, and `groupRoles` never names a group from
 * another org (withAuth filters it, 2a-4), so a foreign group id finds no
 * membership here.
 */
export function resolveGroupScope(
  ctx: RequestContext,
  permission: string,
  groupId: string | null,
  group?: { created_by: string | null },
): boolean {
  if (!isGroupPermission(permission) || ctx.activeOrgId == null) return false;

  const scope = resolveScope(ctx, permission);
  if (scope === 'organization') return true;
  if (scope === 'group') {
    if (groupId === null) return false;
    return ctx.groupRoles[groupId] === 'teacher' || group?.created_by === ctx.userId;
  }
  if (scope === 'own') {
    const grantsOwn =
      isPermissionCatalogKey(permission) &&
      (PERMISSIONS[permission].allowedScopes as readonly PermissionScope[]).includes('own');
    return grantsOwn && group?.created_by === ctx.userId;
  }
  return false;
}

/**
 * Create-time authority over the org's class list, at ANY scope the layout
 * admits: `own`, `group` and `organization` all authorize a create.
 *
 * A new class has no id to be a teacher of, which is why an earlier version of
 * this gate asked for `organization` alone. That read §4.3's scope rows as a
 * hierarchy about the row being touched — but §10 makes a class the teaching
 * surface ("a teacher runs their class without any org-wide management
 * capability"), and creating it is the first thing a teacher does. The operator
 * decision of 2b-2 settles it: a Teacher may create a class, and becomes its
 * teacher, so `group`/`own` is the honest scope for the row they create
 * (ADR-0015 §4.3 scopes, §10 class model). Admin keeps working through
 * `organization`.
 *
 * Not `resolveGroupScope`: that answer needs a group id, and the one thing a
 * create does not have. This asks only whether the caller's role holds the key
 * at all, in the active org.
 */
export function canCreateGroup(ctx: RequestContext, permission = 'group.manage'): boolean {
  // Without an active org `resolveScope` can still answer from a stored row (a
  // stale cookie), and a create would then run against no tenant.
  if (ctx.activeOrgId == null) return false;
  return resolveScope(ctx, permission) !== null;
}

/**
 * A group key for one group. `group.created_by` is optional: a caller that did
 * not select it cannot use the creator branch.
 *
 * Not `can()`: that function is for content resources, and its `group` branch
 * resolves a share link (deck/bank/topic), which a `group.*` key is not. A
 * group row uses only the creator branch of it (ADR-0015 §4.3 `own`).
 */
export function canGroup(
  ctx: RequestContext,
  permission: string,
  group: { id: string; organization_id: string; created_by?: string | null },
): boolean {
  return group.organization_id === ctx.activeOrgId
    ? resolveGroupScope(ctx, permission, group.id, { created_by: group.created_by ?? null })
    : false;
}

/**
 * A group capability the caller must hold for ONE group (ADR-0015 §7:
 * `requirePermission('group.*', { groupId })`).
 *
 * `isGroupPermission` is part of the gate, not a guard clause: a `group.*` check
 * must never become an org-wide answer for some other key, so a non-group
 * permission is refused outright.
 */
export function requireGroupPermission(
  ctx: RequestContext,
  permission: string,
  group: { id: string; organization_id: string; created_by?: string | null },
): void {
  if (!isGroupPermission(permission)) throw new AppError('FORBIDDEN');
  if (!canGroup(ctx, permission, group)) throw new AppError('FORBIDDEN');
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
async function resolveGroupResourceScope(
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

      const { column, ids } = await resolveGroupResourceScope(resourceType, ctx.groupIds);
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
