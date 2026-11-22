import { error as logError } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, isFailure, success, type ServiceResult } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The identity half of `PaymentOwner` (#662 §6.6).
 *
 * Entitlements are keyed by `(kind, id)` only: the plan's scope/audience is a
 * property of the **catalog plan**, not of the write, so the webhook never has
 * to look an auth user up just to apply a plan.
 */
export type EntitlementOwner = { type: 'user'; userId: string } | { type: 'org'; orgId: string };

/**
 * Freshness fence for a webhook-driven entitlement write (#662 security
 * review). The update only lands while the subscription mirror is still at or
 * behind `eventCreated`; a newer cancellation/downgrade wins.
 */
export interface EntitlementFence {
  stripeSubscriptionId: string;
  eventCreated: number;
  /** The mirror generation this snapshot wrote; must still own the row. */
  snapshotGeneration: number;
}

/** `stale` = a newer event already owns the subscription mirror. */
export type EntitlementApplyOutcome = 'applied' | 'stale';

export interface EntitlementPlan {
  key: string;
  scope: string;
  audience: string | null;
  priceMonthly: number;
  isActive: boolean;
}

/**
 * The only writer of plan entitlements (#662 §6.6).
 *
 * Both entitlement columns are source-of-truth state, not derived history:
 *
 * - organization → `rpc('change_org_plan')`, which moves `organizations.plan`
 *   and nothing else (service-role only). The org layer is derived live:
 *   `plan_entitlements`/`plan_limits` plus `org_roles.entitlement_profile`,
 *   with `org_role_features` read as revokes-only (ADR-0015 D19/D31);
 * - user → `profiles.personal_plan_key`, write-locked for `authenticated`
 *   (migration 20261022000001), so it is written with the service-role client.
 *
 * Writes are **absolute** (`set to X`), which is what makes replays and
 * duplicate deliveries harmless. ADR-0007 adds one guard: a paid organization
 * plan must never be written to a profile, because a manager's personal plan is
 * the free manager tier (`launch`) and applies only outside an organization.
 */
export class EntitlementService {
  constructor(
    private readonly createAdminClient: () => SupabaseClient<Database> = createServiceClient,
  ) {}

  /**
   * Apply a plan to its owner. Idempotent: re-applying the current plan is a
   * no-op at the database level.
   */
  async applyPlan(owner: EntitlementOwner, planKey: string): Promise<ServiceResult<void>> {
    const planResult = await this.resolveWritablePlan(owner, planKey);
    if (isFailure(planResult)) return planResult;

    if (owner.type === 'org') {
      // The plan move is the whole write: features and limits resolve live
      // from `organizations.plan`, so there is no snapshot to re-sync.
      const admin = this.createAdminClient();
      const { error } = await admin.rpc('change_org_plan', {
        p_org_id: owner.orgId,
        p_plan: planKey,
      });
      if (error) return toDbFailure(error);
      return success(undefined);
    }

    const admin = this.createAdminClient();
    const { error } = await admin
      .from('profiles')
      .update({ personal_plan_key: planKey })
      .eq('id', owner.userId);

    if (error) return toDbFailure(error);
    return success(undefined);
  }

  /**
   * Fenced variant used by the Stripe webhook. The freshness check and the
   * entitlement mutation run in one database transaction
   * (`apply_entitlement_fenced`), which locks the subscription mirror row. A
   * concurrent newer cancellation/downgrade therefore either commits first
   * (and this older snapshot reports `stale`) or waits for this write and then
   * replaces it with its own newer plan. The previous check-then-write left a
   * window where an older paid plan could overwrite the newer downgrade.
   */
  async applyPlanFenced(
    owner: EntitlementOwner,
    planKey: string,
    fence: EntitlementFence,
  ): Promise<ServiceResult<EntitlementApplyOutcome>> {
    const planResult = await this.resolveWritablePlan(owner, planKey);
    if (isFailure(planResult)) return planResult;

    const admin = this.createAdminClient();
    const { data, error } = await admin.rpc('apply_entitlement_fenced', {
      p_owner_type: owner.type,
      p_owner_id: owner.type === 'org' ? owner.orgId : owner.userId,
      p_plan: planKey,
      p_subscription_id: fence.stripeSubscriptionId,
      p_event_created: fence.eventCreated,
      p_snapshot_generation: fence.snapshotGeneration,
    });

    if (error) return toDbFailure(error);
    return success(data ? 'applied' : 'stale');
  }

  /**
   * Downgrade to the free plan of the previous plan's scope/audience (`base`
   * for students, `lite` for educators, `solo` for managers, `launch` for
   * organizations — D32/D34).
   *
   * The scope/audience comes from the catalog row of the plan being left,
   * never from the caller's claims: a `customer.subscription.deleted` payload
   * does not carry an account type, and the catalog is the single source of
   * truth.
   */
  async downgradeToFree(
    owner: EntitlementOwner,
    previousPlanKey: string | null,
  ): Promise<ServiceResult<void>> {
    const freeResult = await this.resolveFreePlan(owner, previousPlanKey);
    if (isFailure(freeResult)) return freeResult;

    return this.applyPlan(owner, freeResult.data.key);
  }

  /** Fenced counterpart of `downgradeToFree` (see `applyPlanFenced`). */
  async downgradeToFreeFenced(
    owner: EntitlementOwner,
    previousPlanKey: string | null,
    fence: EntitlementFence,
  ): Promise<ServiceResult<EntitlementApplyOutcome>> {
    const freeResult = await this.resolveFreePlan(owner, previousPlanKey);
    if (isFailure(freeResult)) return freeResult;

    return this.applyPlanFenced(owner, freeResult.data.key, fence);
  }

  /**
   * Validate a catalog plan before it is written: it must exist, and an
   * organization-scope plan must never be written to a profile (ADR-0007,
   * D32: `scope='organization'`, no price condition — `launch` included).
   */
  private async resolveWritablePlan(
    owner: EntitlementOwner,
    planKey: string,
  ): Promise<ServiceResult<EntitlementPlan>> {
    const planResult = await this.getPlan(planKey);
    if (isFailure(planResult)) return planResult;

    const plan = planResult.data;
    if (!plan) {
      logError('billing.plan_not_found', { planKey, ownerType: owner.type });
      return failure('BAD_REQUEST');
    }

    // ADR-0007: an organization plan written to a profile would widen that
    // user's limits in every organization they belong to, so reject + alert
    // instead of silently corrupting the entitlement.
    if (owner.type === 'user' && this.isOrganizationPlan(plan)) {
      logError('billing.org_plan_to_profile', {
        planKey,
        userId: owner.userId,
      });
      return failure('FORBIDDEN');
    }

    return success(plan);
  }

  private isOrganizationPlan(plan: EntitlementPlan): boolean {
    return plan.scope === 'organization';
  }

  private async resolveFreePlan(
    owner: EntitlementOwner,
    previousPlanKey: string | null,
  ): Promise<ServiceResult<EntitlementPlan>> {
    let scope: string | null = null;
    let audience: string | null = null;

    if (previousPlanKey) {
      const previous = await this.getPlan(previousPlanKey);
      if (isFailure(previous)) return previous;
      scope = previous.data?.scope ?? null;
      audience = previous.data?.audience ?? null;
    }

    // Fallback only when the previous plan row disappeared: an organization
    // downgrades to the free organization plan; a user defaults to the free
    // student plan.
    if (!scope) {
      scope = owner.type === 'org' ? 'organization' : 'personal';
      audience = owner.type === 'org' ? null : 'student';
    }

    const admin = this.createAdminClient();
    // The catalog has at most one active free plan per scope/audience pair,
    // but filter in JS instead of `.eq('audience', null)` — Supabase would
    // serialize a null filter as `= null` (the #148 footgun).
    const { data, error } = await admin
      .from('subscription_plans')
      .select('key, scope, audience, price_monthly, is_active, sort_order')
      .eq('price_monthly', 0)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) return toDbFailure(error);

    const freePlan = dbRows(data).find((row) => row.scope === scope && row.audience === audience);
    if (!freePlan) {
      logError('billing.free_plan_missing', { scope, audience, ownerType: owner.type });
      return failure('NOT_FOUND');
    }

    return success({
      key: freePlan.key,
      scope: freePlan.scope,
      audience: freePlan.audience,
      priceMonthly: freePlan.price_monthly ?? 0,
      isActive: freePlan.is_active ?? true,
    });
  }

  private async getPlan(planKey: string): Promise<ServiceResult<EntitlementPlan | null>> {
    const admin = this.createAdminClient();
    const { data, error } = await admin
      .from('subscription_plans')
      .select('key, scope, audience, price_monthly, is_active')
      .eq('key', planKey)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return success(null);

    return success({
      key: data.key,
      scope: data.scope,
      audience: data.audience,
      priceMonthly: data.price_monthly ?? 0,
      isActive: data.is_active ?? true,
    });
  }
}

export const entitlementService = wrapService(new EntitlementService(), 'entitlement.service');
