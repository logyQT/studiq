import {
  type PermissionScope,
  type ResourceAccess,
  evaluateScope as scopeCheck,
} from './permissions';

export function evaluate(args: {
  scope: PermissionScope | null | undefined;
  userId: string;
  resource: ResourceAccess;
}): boolean {
  return scopeCheck(args.scope, args.userId, args.resource);
}

export type { PermissionKey, PermissionScope, ResourceAccess } from './permissions';
export { DEFAULT_ROLE_PERMISSIONS, evaluateScope, Permission } from './permissions';
