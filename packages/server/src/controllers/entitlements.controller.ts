import type { EntitlementKey, PlanSource, RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { resolveEntitlements } from '@studiq/server/lib/entitlements';
import { wrapService } from '@studiq/server/lib/observability';

export interface MyEntitlementsData {
  /** The org the set was resolved for; null is the personal (no-org) layer. */
  orgId: string | null;
  /** The effective set: the resolver has already dropped quota-0 keys (§6.1). */
  entitlements: EntitlementKey[];
  /**
   * Every `LIMIT_KEYS` entry, `0` for a missing `plan_limits` row (§6.2) — the
   * resolver's own record, not a re-derived one. `Record<string, number>` is the
   * shape `ResolvedEntitlements` and `PlanInfo` both publish; completeness
   * (every `LIMIT_KEYS` entry present) is the resolver's contract, pinned by
   * `entitlement.resolver.limits.test.ts` — this controller only passes it through,
   * and its own test mocks the resolver.
   */
  limits: Record<string, number>;
  plan: { primary: string; sources: PlanSource[] };
}

export class EntitlementsController {
  async myEntitlements(ctx: RequestContext): Promise<ControllerResponse<MyEntitlementsData>> {
    const resolved = await resolveEntitlements(ctx);

    return {
      success: true,
      statusCode: 200,
      data: {
        orgId: ctx.activeOrgId,
        entitlements: resolved.entitlements,
        limits: resolved.limits,
        plan: resolved.plan,
      },
    };
  }
}
export const entitlementsController = wrapService(
  new EntitlementsController(),
  'entitlements.controller',
);
