/**
 * Resolves the organization an organization plan is being bought for.
 *
 * The membership list must come from the self-scoped `GET /api/v1/me/orgs`
 * (RLS: members only). An `org_id` the caller does not belong to therefore
 * resolves to the same `not-member` state as an id that does not exist — the
 * page never learns a name it is not allowed to see.
 *
 * This is a *cosmetic* gate: the server re-checks admin membership in
 * `createCheckoutSession` and `handleWebhook` (`assertOrgAdmin`).
 */
import { isOrgAdminRole } from '@studiq/authz';

/** Minimal shape of a `GET /api/v1/me/orgs` row that the checkout cares about. */
export type CheckoutOrg = {
  id: string;
  name: string;
  orgRoleName: string;
  isActive: boolean;
};

export type OrgsStatus = 'pending' | 'error' | 'ready';

export type CheckoutOrgResolution =
  | { status: 'not-org-plan' }
  | { status: 'missing-org-id' }
  | { status: 'loading' }
  | { status: 'load-error' }
  | { status: 'not-member' }
  | { status: 'not-admin'; org: CheckoutOrg; isDifferentFromActive: boolean }
  | { status: 'ok'; org: CheckoutOrg; isDifferentFromActive: boolean };

/**
 * `isDifferentFromActive` means "another organization is the active one", not
 * `!org.isActive`: on a direct visit to `/checkout` the `active_org_id` cookie
 * may not be pinned yet, so every row comes back with `isActive: false`. Only
 * a positively-active *other* org is a hint that the user may be on the wrong
 * org.
 */
export function resolveCheckoutOrg(input: {
  isOrgPlan: boolean;
  orgId: string | null;
  orgs: readonly CheckoutOrg[] | undefined;
  orgsStatus: OrgsStatus;
}): CheckoutOrgResolution {
  const { isOrgPlan, orgsStatus } = input;
  if (!isOrgPlan) return { status: 'not-org-plan' };

  const orgId = input.orgId?.trim() || null;
  if (!orgId) return { status: 'missing-org-id' };

  if (orgsStatus === 'error') return { status: 'load-error' };
  if (orgsStatus === 'pending' || !input.orgs) return { status: 'loading' };

  const org = input.orgs.find((o) => o.id === orgId);
  if (!org) return { status: 'not-member' };

  const isDifferentFromActive = input.orgs.some((o) => o.isActive && o.id !== org.id);
  if (!isOrgAdminRole(org.orgRoleName)) {
    return { status: 'not-admin', org, isDifferentFromActive };
  }
  return { status: 'ok', org, isDifferentFromActive };
}
