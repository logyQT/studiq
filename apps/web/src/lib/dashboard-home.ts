import {
  isPermissionCatalogKey,
  PERMISSIONS,
  Permission,
  type PermissionKey,
  type PermissionScope,
} from '@studiq/authz';
import { resolveNeedsOnboarding } from '@/lib/onboarding';

export type DashboardArea = '/edu' | '/manage' | '/app';

/** What the landing may resolve: an area, or one of the two onboarding exceptions. */
export type LandingArea = DashboardArea | '/setup' | '/setup/org';

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

/**
 * Every key that makes `/edu` usable at all — a different question from "is this
 * `/edu`'s home" (`resolveDashboardArea`) and from "may this caller create a
 * class" (`EDUCATOR_AREA_KEYS`).
 *
 * It is the whole class family plus every content `read`: the area's pages are
 * the class list and the content surfaces, and a Member legitimately uses the
 * latter. Derived from `PERMISSIONS` so a new family or a new `.read` key joins
 * the gate by declaration instead of by a hand-written list (R40).
 */
const EDU_AREA_KEYS: readonly PermissionKey[] = Object.keys(PERMISSIONS)
  .filter(isPermissionCatalogKey)
  .filter(
    (key) =>
      PERMISSIONS[key].category === 'group' ||
      (PERMISSIONS[key].category === 'content' && key.endsWith('.read')),
  );

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

/**
 * Whether the caller may use anything in an area — the gate's question, and
 * deliberately broader than the landing's "where is home" predicate above.
 *
 * The landing answers which shell to open first, so it names the keys that
 * *typify* an area (the nine `org.*` keys, the three class-management keys). The
 * gate answers "may this caller reach any page of this area", so it also counts
 * the content reads: a Member holds `deck.read`, `question_bank.read` and the
 * other reads at `group` or `own`, and `/edu` is where those surfaces live, so
 * sending them the no-access card would refuse a page the API happily serves.
 * The reverse case is what the wider set must still catch: a Billing preset
 * holder (`org.billing.manage` + `org.seat.manage`) holds no content read, so
 * `/edu` is closed to them while `/manage` is open.
 *
 * Presence only, like `resolveDashboardArea` and `SidebarGates.permission`: an
 * area entry has no resource row to evaluate a scope against.
 */
export function hasAreaAccess(
  permissions: PermissionMap | undefined,
  area: '/manage' | '/edu',
): boolean {
  return holdsAny(permissions, area === '/manage' ? MANAGER_AREA_KEYS : EDU_AREA_KEYS);
}

export interface LandingInput {
  /** Memberships `/me/orgs` reported. */
  orgsCount: number;
  /** `['orgs']` has not resolved yet. */
  orgsPending: boolean;
  /** A `/me/orgs` request is in flight (a refetch over cached data included). */
  orgsFetching: boolean;
  /** The first-org auto-selection is in flight. */
  isSwitching: boolean;
  /** The org `/me/orgs` reports as active; `null` is the personal layer. */
  activeOrgId: string | null;
  /** `app_metadata.account_type`, read by the onboarding branch alone. */
  accountType?: string | null;
  /** The `/me/permissions` answer, absent until it resolves. */
  permissions?: { orgId: string | null; permissions: PermissionMap };
}

/**
 * Which first-run screen a settled, org-less staff account gets — the two
 * declared onboarding exceptions (ADR-0015 §7: `/setup/org` MANAGER, `/setup`
 * EDUCATOR). Read only after `resolveNeedsOnboarding` has said onboarding
 * applies, and never fed back into `resolveDashboardArea`.
 */
function onboardingPath(accountType?: string | null): '/setup' | '/setup/org' {
  return accountType === 'manager' ? '/setup/org' : '/setup';
}

/**
 * The landing's answer once it can be trusted, or `null` while it cannot.
 *
 * Onboarding comes before the permission answer: since 6c a caller without an org
 * holds the 24 personal keys, so `resolveDashboardArea` would answer `/app` for a
 * first-run manager or educator and the declared `/setup*` exception would never
 * be reached from `/login`. A first-run learner is unaffected — it has no staff
 * persona, so the personal set still resolves `/app`.
 *
 * Two waits after that are easy to get wrong and both are silent: resolving
 * before the first-org auto-selection has run sends the caller to `/app` (the
 * personal map under a `null` active org); resolving from an answer that names a
 * different org — a payload written under the outgoing key — renders the previous
 * org's shell under the new one (ADR-0015 §7.1, design §3.4).
 */
export function resolveLandingArea(input: LandingInput): LandingArea | null {
  if (
    resolveNeedsOnboarding({
      orgsCount: input.orgsCount,
      isPending: input.orgsPending,
      isFetching: input.orgsFetching,
      accountType: input.accountType,
    })
  ) {
    return onboardingPath(input.accountType);
  }

  const permissions = input.permissions;
  if (input.orgsPending || input.isSwitching || !permissions) return null;
  // A settled membership list whose active org is still `null` is between the
  // list and the auto-select: the map under `null` describes the personal layer,
  // not the org this caller is about to enter.
  if (input.orgsCount > 0 && input.activeOrgId === null) return null;
  if (permissions.orgId !== input.activeOrgId) return null;
  return resolveDashboardArea(permissions.permissions);
}
