import {
  type PermissionScope,
  type ResourceAccess,
  evaluateScope as scopeCheck,
} from '@/lib/permissions';

export function evaluate(args: {
  scope: PermissionScope | null | undefined;
  userId: string;
  resource: ResourceAccess;
}): boolean {
  return scopeCheck(args.scope, args.userId, args.resource);
}

export type { PermissionKey, PermissionScope, ResourceAccess } from '@/lib/permissions';
export { DEFAULT_ROLE_PERMISSIONS, evaluateScope, Permission } from '@/lib/permissions';
