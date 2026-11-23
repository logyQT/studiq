import type { EntitlementKey, RequestContext, ResolvedEntitlements } from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { entitlementResolver } from '@studiq/server/services/entitlement.resolver';

/**
 * ADR-0015 §6/§7: the resolver is the only reader that composes the layers
 * into an effective entitlement set, so this module is the only gate.
 * `/api/v1/me/entitlements` reads through it, so the published set and the
 * gated set cannot drift.
 */
export async function resolveEntitlements(ctx: RequestContext): Promise<ResolvedEntitlements> {
  return entitlementResolver.resolveEntitlements(ctx);
}

/**
 * The single paid-surface gate (ADR-0015 §7): throws `FORBIDDEN` when the key
 * is not in the caller's effective entitlement set — which already excludes a
 * quota-0 key (§6.1) and fails closed on a missing flag row. No persona input.
 */
export async function requireEntitlement(ctx: RequestContext, key: EntitlementKey): Promise<void> {
  const { entitlements } = await entitlementResolver.resolveEntitlements(ctx);
  if (!entitlements.includes(key)) throw new AppError('FORBIDDEN');
}
