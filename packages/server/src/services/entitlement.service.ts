import { error as logError } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, isFailure, success, type ServiceResult } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The identity half of `PaymentOwner` (#662 §6.6).
 *
 * Entitlements are keyed by `(kind, id)` only: the account type is a property
 * of the **catalog plan** (`for_account_type`), not of the write, so the
 * webhook never has to look an auth user up just to apply a plan.
 */
export type EntitlementOwner = { type: 'user'; userId: string } | { type: 'org'; orgId: string };

export interface EntitlementPlan {
  key: string;
  forAccountType: string | null;
  priceMonthly: number;
  isActive: boolean;
}

/** `for_account_type` of the plan catalog; `manager` is the organization family. */
const ORGANIZATION_PLAN_FAMILY = 'manager';

/**
 * The only writer of plan entitlements (#662 §6.6).
 *
 * Both entitlement columns are source-of-truth state, not derived history:
 *
 * - organization → `rpc('apply_org_plan')`, which moves `organizations.plan`
 *   and re-syncs the `org_role_features` snapshot (service-role only);
 * - user → `profiles.personal_plan_key`, write-locked for `authenticated`
 *   (migration 20261022000001), so it is written with the service-role client.
 *
 * Writes are **absolute** (`set to X`), which is what makes replays and
 * duplicate deliveries harmless. ADR-0007 adds one guard: a paid organization
 * plan must never be written to a profile, because a manager's personal plan is
 * the free manager tier (`launch`) and applies only outside an organization.
 */
export class EntitlementService {
  constructor(private readonly createAdminClient: () => SupabaseClient = createServiceClient) {}

  /**
   * Apply a plan to its owner. Idempotent: re-applying the current plan is a
   * no-op at the database level.
   */
  async applyPlan(owner: EntitlementOwner, planKey: string): Promise<ServiceResult<void>> {
    const planResult = await this.getPlan(planKey);
    if (isFailure(planResult)) return planResult;

    const plan = planResult.data;
    if (!plan) {
      logError('billing.plan_not_found', { planKey, ownerType: owner.type });
      return failure('BAD_REQUEST');
    }

    if (owner.type === 'org') {
      // organizations.plan alone changes nothing: features and limits are
      // snapshots, so the DB function moves the plan and re-syncs them.
      const admin = this.createAdminClient();
      const { error } = await admin.rpc('apply_org_plan', {
        p_org_id: owner.orgId,
        p_plan: planKey,
      });
      if (error) return toDbFailure(error);
      return success(undefined);
    }

    // ADR-0007: a manager plan is an organization plan. Writing it to a profile
    // would widen that manager's limits in every organization they belong to,
    // so reject + alert instead of silently corrupting the entitlement.
    if (this.isOrganizationPlan(plan)) {
      logError('billing.manager_plan_to_profile', {
        planKey,
        userId: owner.userId,
      });
      return failure('FORBIDDEN');
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
   * Downgrade to the free plan of the previous plan's family (`base` for
   * students, `lite` for educators, `launch` for organizations/managers).
   *
   * The family comes from the catalog row of the plan being left, never from
   * the caller's claims: a `customer.subscription.deleted` payload does not
   * carry an account type, and the catalog is the single source of truth.
   */
  async downgradeToFree(
    owner: EntitlementOwner,
    previousPlanKey: string | null,
  ): Promise<ServiceResult<void>> {
    const freeResult = await this.resolveFreePlan(owner, previousPlanKey);
    if (isFailure(freeResult)) return freeResult;

    return this.applyPlan(owner, freeResult.data.key);
  }

  private isOrganizationPlan(plan: EntitlementPlan): boolean {
    return plan.forAccountType === ORGANIZATION_PLAN_FAMILY && plan.priceMonthly > 0;
  }

  private async resolveFreePlan(
    owner: EntitlementOwner,
    previousPlanKey: string | null,
  ): Promise<ServiceResult<EntitlementPlan>> {
    let family: string | null = null;

    if (previousPlanKey) {
      const previous = await this.getPlan(previousPlanKey);
      if (isFailure(previous)) return previous;
      family = previous.data?.forAccountType ?? null;
    }

    // Fallback only when the previous plan row disappeared: an organization
    // always uses the manager family; a user defaults to the student tier.
    if (!family) family = owner.type === 'org' ? ORGANIZATION_PLAN_FAMILY : 'student';

    const admin = this.createAdminClient();
    // The catalog has at most one active free plan per family, but filter in
    // JS instead of `.eq('for_account_type', null)` — Supabase would serialize
    // a null filter as `= null` (the #148 footgun).
    const { data, error } = await admin
      .from('subscription_plans')
      .select('key, for_account_type, price_monthly, is_active, sort_order')
      .eq('price_monthly', 0)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) return toDbFailure(error);

    const freePlan = (data ?? []).find((row) => row.for_account_type === family);
    if (!freePlan) {
      logError('billing.free_plan_missing', { family, ownerType: owner.type });
      return failure('NOT_FOUND');
    }

    return success({
      key: freePlan.key as string,
      forAccountType: (freePlan.for_account_type as string | null) ?? null,
      priceMonthly: (freePlan.price_monthly as number | null) ?? 0,
      isActive: (freePlan.is_active as boolean | null) ?? true,
    });
  }

  private async getPlan(planKey: string): Promise<ServiceResult<EntitlementPlan | null>> {
    const admin = this.createAdminClient();
    const { data, error } = await admin
      .from('subscription_plans')
      .select('key, for_account_type, price_monthly, is_active')
      .eq('key', planKey)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return success(null);

    return success({
      key: data.key as string,
      forAccountType: (data.for_account_type as string | null) ?? null,
      priceMonthly: (data.price_monthly as number | null) ?? 0,
      isActive: (data.is_active as boolean | null) ?? true,
    });
  }
}

export const entitlementService = wrapService(new EntitlementService(), 'entitlement.service');
