import { evaluate } from '@/lib/authz';
import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { AccountType } from '@/types';
import type { PermissionKey, PermissionScope } from './permissions';
import { Permission } from './permissions';

export type { PermissionKey, PermissionScope };
export { Permission };

export interface Resource {
  id: string;
  created_by: string;
  organization_id: string | null;
}

export async function getScope(
  accountType: AccountType,
  orgRoleId: string | null,
  permission: string,
): Promise<PermissionScope | null> {
  if (orgRoleId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('org_role_permissions')
      .select('scope')
      .eq('org_role_id', orgRoleId)
      .eq('permission_name', permission)
      .maybeSingle();
    if (data) return data.scope as PermissionScope;
  }

  if (accountType === AccountType.STUDENT || accountType === AccountType.EDUCATOR) {
    if (
      permission.endsWith('.read') ||
      permission.endsWith('.create') ||
      permission.endsWith('.update') ||
      permission.endsWith('.delete')
    ) {
      return 'own';
    }
  }

  return null;
}

export async function checkPermission(
  ctx: RequestContext,
  permission: string,
  resource: Resource | null,
) {
  const scope = await getScope(ctx.accountType, ctx.orgRoleId, permission);
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

export async function hasPermission(ctx: RequestContext, permission: string): Promise<boolean> {
  const scope = await getScope(ctx.accountType, ctx.orgRoleId, permission);
  return scope !== null;
}

export async function buildQueryFilter(
  ctx: RequestContext,
  permission: string,
  _resourceType?: string,
) {
  const scope = await getScope(ctx.accountType, ctx.orgRoleId, permission);
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
