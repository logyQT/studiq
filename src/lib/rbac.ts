import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { UserRole } from '@/types';

export type PermissionScope = 'own' | 'university' | 'any';

export const Permission = {
  FLASHCARD_READ: 'flashcard.read',
  FLASHCARD_CREATE: 'flashcard.create',
  FLASHCARD_UPDATE: 'flashcard.update',
  FLASHCARD_DELETE: 'flashcard.delete',
  TOPIC_READ: 'topic.read',
  TOPIC_CREATE: 'topic.create',
  TOPIC_UPDATE: 'topic.update',
  TOPIC_DELETE: 'topic.delete',
  DECK_READ: 'deck.read',
  DECK_CREATE: 'deck.create',
  DECK_UPDATE: 'deck.update',
  DECK_DELETE: 'deck.delete',
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

export interface Resource {
  id: string;
  created_by: string;
  organization_id: string | null;
}

type RolePermissionMap = Map<UserRole, Map<string, PermissionScope>>;

let cachedRolePermissions: RolePermissionMap | null = null;
let loadPromise: Promise<RolePermissionMap> | null = null;

async function ensureRolePermissionsLoaded(): Promise<RolePermissionMap> {
  if (cachedRolePermissions) return cachedRolePermissions;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('role_permissions')
      .select('role, scope, permissions!inner(name)');

    if (error || !data) {
      console.error('[ensureRolePermissionsLoaded] query failed:', JSON.stringify(error), 'data:', !!data);
      cachedRolePermissions = new Map();
      return cachedRolePermissions;
    }

    const map = new Map<UserRole, Map<string, PermissionScope>>();

    for (const row of data) {
      const role = row.role as UserRole;
      const permissionName = (row as unknown as { role: string; scope: string; permissions: { name: string } }).permissions.name;
      const scope = row.scope as PermissionScope;

      if (!permissionName) continue;

      if (!map.has(role)) {
        map.set(role, new Map());
      }
      map.get(role)!.set(permissionName, scope);
    }

    cachedRolePermissions = map;
    return map;
  })();

  return loadPromise;
}

export async function loadRolePermissions(): Promise<RolePermissionMap> {
  return ensureRolePermissionsLoaded();
}

export function clearRolePermissionCache() {
  cachedRolePermissions = null;
  loadPromise = null;
}

async function getScopeForRole(role: UserRole, permission: string): Promise<PermissionScope | null> {
  await ensureRolePermissionsLoaded();
  return cachedRolePermissions!.get(role)?.get(permission) ?? null;
}

export async function checkPermission(ctx: RequestContext, permission: string, resource: Resource | null) {
  const scope = await getScopeForRole(ctx.role, permission);
  if (!scope) throw new AppError('FORBIDDEN');

  switch (scope) {
    case 'any':
      return;
    case 'university':
      if (!resource) throw new AppError('FORBIDDEN');
      if (resource.created_by === ctx.userId) return;
      if (resource.organization_id !== ctx.activeOrgId) throw new AppError('FORBIDDEN');
      return;
    case 'own':
      if (!resource || resource.created_by !== ctx.userId) {
        throw new AppError('FORBIDDEN');
      }
      return;
  }
}

export async function hasPermission(ctx: RequestContext, permission: string): Promise<boolean> {
  const scope = await getScopeForRole(ctx.role, permission);
  return scope !== null;
}

export async function shouldSetUniversityId(ctx: RequestContext, permission: string): Promise<boolean> {
  const scope = await getScopeForRole(ctx.role, permission);
  return scope === 'university' || scope === 'any';
}

export async function buildQueryFilter(ctx: RequestContext, permission: string, _resourceType?: string) {
  const scope = await getScopeForRole(ctx.role, permission);
  if (!scope) return { _impossible: true };

  switch (scope) {
    case 'any':
      return {};
    case 'university':
      return { or: `created_by.eq.${ctx.userId},organization_id.eq.${ctx.activeOrgId}` };
    case 'own':
      return { created_by: ctx.userId };
  }
}
