import type { AccountType, Nullable } from '../types';
import type { PermissionScope } from './permissions';

export interface RequestContext {
  traceId: string;
  userId: string;
  accountType: AccountType;
  orgRoleId: string | null;
  activeOrgId: Nullable<string>;
  url: string;
  method: string;
  groupIds: string[];
  permissionScopes: Partial<Record<string, PermissionScope>>;
}
