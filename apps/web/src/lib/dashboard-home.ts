import { Permission, type PermissionKey, type PermissionScope } from '@studiq/authz';

export type DashboardArea = '/edu' | '/manage' | '/app';

/**
 * A permission map as `/api/v1/me/permissions` answers it: every key the
 * resolver has an answer for, `null` where the caller holds none.
 */
export type PermissionMap = Partial<Record<PermissionKey, PermissionScope | null>>;

/**
 * The nine organization-wide keys. Holding any one of them makes `/manage` this
 * caller's area, whether the caller is the seeded Admin role or a custom role
 * granted a single management key (#1391: the persona is not an input).
 */
const MANAGER_AREA_KEYS: readonly PermissionKey[] = [
  Permission.ORG_SETTINGS_MANAGE,
  Permission.ORG_MEMBER_MANAGE,
  Permission.ORG_INVITATION_MANAGE,
  Permission.ORG_ROLE_MANAGE,
  Permission.ORG_SEAT_MANAGE,
  Permission.ORG_BILLING_MANAGE,
  Permission.ORG_REPORT_MANAGE,
  Permission.ORG_AUDIT_READ,
  Permission.ORG_ADMIN,
];

/** The class keys a Teacher holds, and the only reason to land on `/edu`. */
const EDUCATOR_AREA_KEYS: readonly PermissionKey[] = [
  Permission.GROUP_MANAGE,
  Permission.GROUP_INVITE,
  Permission.GROUP_MEMBER_MANAGE,
];

function holdsAny(permissions: PermissionMap | undefined, keys: readonly PermissionKey[]): boolean {
  return keys.some((key) => Boolean(permissions?.[key]));
}

/**
 * The dashboard area for a permission map — the one place the shell decides
 * which of `/manage`, `/edu` or `/app` is home (ADR-0015 §7.1, R40).
 *
 * Presence is enough: the caller's *role in the active org* is what the map
 * describes, and an area entry has no resource row to evaluate a scope against
 * (same rule as `SidebarGates.permission`). No org, an empty map and a map that
 * has not resolved yet all reach the last branch: `/app` is the personal shell,
 * and since 6c it is correct for a caller without an org.
 */
export function resolveDashboardArea(permissions?: PermissionMap): DashboardArea {
  if (holdsAny(permissions, MANAGER_AREA_KEYS)) return '/manage';
  if (holdsAny(permissions, EDUCATOR_AREA_KEYS)) return '/edu';
  return '/app';
}

export interface LandingInput {
  /** `['orgs']` has not resolved yet. */
  orgsPending: boolean;
  /** The first-org auto-selection is in flight. */
  isSwitching: boolean;
  /** The org `/me/orgs` reports as active; `null` is the personal layer. */
  activeOrgId: string | null;
  /** The `/me/permissions` answer, absent until it resolves. */
  permissions?: { orgId: string | null; permissions: PermissionMap };
}

/**
 * The landing's area once its answer can be trusted, or `null` while it cannot.
 *
 * Two conditions are easy to get wrong and both are silent: resolving before the
 * first-org auto-selection has run sends the caller to `/app` (the personal map);
 * resolving from an answer that names a different org — a payload written under
 * the outgoing key — renders the previous org's shell under the new one (ADR-0015
 * §7.1, design §3.4). Comparing the two ids is the check that closes both.
 */
export function resolveLandingArea(input: LandingInput): DashboardArea | null {
  const permissions = input.permissions;
  if (input.orgsPending || input.isSwitching || !permissions) return null;
  if (permissions.orgId !== input.activeOrgId) return null;
  return resolveDashboardArea(permissions.permissions);
}
