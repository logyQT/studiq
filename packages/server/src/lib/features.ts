import type { EntitlementKey, RequestContext, ResolvedEntitlements } from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { entitlementResolver } from '@studiq/server/services/entitlement.resolver';

// Thin wrappers over the single resolver (ADR-0015 phase 3a) until phase 6
// renames the module and the `/features/me` endpoint; the HTTP semantics are
// unchanged (`requireFeature` throws `AppError('FORBIDDEN')` → 403 +
// `x-error-code`).

export async function resolveFeatures(ctx: RequestContext): Promise<ResolvedEntitlements> {
  return entitlementResolver.resolveEntitlements(ctx);
}

export async function getEnabledFeatures(ctx: RequestContext): Promise<EntitlementKey[]> {
  return (await entitlementResolver.resolveEntitlements(ctx)).entitlements;
}

/**
 * Throws `FORBIDDEN` when the key is not effective for the caller — which
 * includes the quota-0 case: an entitlement whose quota limit resolves to `0`
 * is excluded from the resolved set (§6.1).
 */
export async function requireFeature(ctx: RequestContext, key: EntitlementKey): Promise<void> {
  const { entitlements } = await entitlementResolver.resolveEntitlements(ctx);
  if (!entitlements.includes(key)) throw new AppError('FORBIDDEN');
}
