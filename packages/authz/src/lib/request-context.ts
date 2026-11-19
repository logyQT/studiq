import type { AccountType, Nullable } from '../types';
import type { PermissionScope } from './permissions';

/** A `group_members.role` value, as the table's CHECK constraint allows it. */
export type GroupRole = 'teacher' | 'member';

export const GROUP_ROLES: readonly GroupRole[] = ['teacher', 'member'];

export function isGroupRole(value: unknown): value is GroupRole {
  return value === 'teacher' || value === 'member';
}

export interface RequestContext {
  traceId: string;
  userId: string;
  accountType: AccountType;
  orgRoleId: string | null;
  activeOrgId: Nullable<string>;
  url: string;
  method: string;
  /**
   * Group memberships in the active org only, and `groupRoles`' keys — the two
   * are built from one read so they cannot disagree. Both are empty with no
   * active org (ADR-0015 §7.1: no union of group roles across orgs).
   */
  groupIds: string[];
  groupRoles: Readonly<Record<string, GroupRole>>;
  permissionScopes: Partial<Record<string, PermissionScope>>;
}
