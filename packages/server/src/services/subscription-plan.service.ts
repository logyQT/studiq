import {
  ENTITLEMENTS,
  isEntitlementKey,
  type PlanSource,
  type RequestContext,
} from '@studiq/authz';
import { hasPermission, Permission } from '@studiq/server/lib/authz';
import { dbNested, dbRows } from '@studiq/server/lib/supabase/rows';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  CreateSubscriptionPlanInput,
  UpdateSubscriptionPlanInput,
} from '@studiq/server/models/subscription-plan.model';
import { entitlementResolver } from '@studiq/server/services/entitlement.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

export interface PlanInfo {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  features: string[];
  limits: Record<string, number>;
  /** The union the effective `features`/`limits` were composed from (D28, phase 3b). */
  sources: PlanSource[];
  sortOrder: number;
  isActive: boolean;
  /** No plan carries an audience since #1193; the field remains for the column. */
  scope: string;
  audience: string | null;
  /**
   * Derived from the live `entitlement_catalog` (D33): true iff the plan
   * carries at least one entitlement and every one of its keys is
   * `seatEligible`. That is the *key* half of the licence rule — a pool's plan
   * must also be `scope === 'personal'`, which `addPool` and the seats picker
   * check separately (an organization plan's keys are all seat-eligible too).
   */
  seatEligible: boolean;
}

type SubscriptionPlanRow = Database['public']['Tables']['subscription_plans']['Row'];

/**
 * One `plan_entitlements` row with its catalog embed, as the reads select it.
 * Structural, so the typed query result passes without an assertion.
 */
type PlanEntitlementRead = {
  plan_key: string;
  entitlement_key: string;
  entitlement_catalog: { seat_eligible: boolean } | null;
};

/** Raw query-param values; an unknown value simply matches no plan. */
export interface PlanCatalogFilters {
  scope?: string;
}

export class SubscriptionPlanService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  private async fetchLimitsByPlan(
    planKeys: string[],
  ): Promise<Map<string, Record<string, number>>> {
    const supabase = await this.clientFactory();
    const { data: planLimits } = await supabase
      .from('plan_limits')
      .select('plan_key, limit_key, limit_value')
      .in('plan_key', planKeys);

    const limitsByPlan = new Map<string, Record<string, number>>();
    for (const pl of planLimits ?? []) {
      if (!limitsByPlan.has(pl.plan_key)) {
        limitsByPlan.set(pl.plan_key, {});
      }
      limitsByPlan.get(pl.plan_key)![pl.limit_key] = pl.limit_value;
    }
    return limitsByPlan;
  }

  /**
   * The keys a buyer actually receives — the public reads mirror the
   * resolver's step-4 catalog filter and step-11 flag gate (D8/D9): an unknown
   * key is dropped, a surface key survives only with an enabled flag row, a
   * baseline key is never gated. The flag state comes from `entitlement_flags`,
   * not from a TS constant (R37).
   *
   * This filters `features` only. `seatEligible` keeps reading the unfiltered
   * rows because it mirrors `addPool` (`seat.service.ts`), which reads the full
   * plan-row set; deriving it from filtered rows would flip a plan with a mixed
   * key set (a non-seat-eligible key beside eligible ones) to `true` and let
   * `addPool` accept it.
   */
  private static advertisedFeatures(
    entitlementRows: readonly PlanEntitlementRead[],
    flagStates: ReadonlyMap<string, boolean | null>,
  ): string[] {
    const features: string[] = [];
    for (const row of entitlementRows) {
      if (!isEntitlementKey(row.entitlement_key)) continue;
      const gated = ENTITLEMENTS[row.entitlement_key].category === 'surface';
      if (gated && flagStates.get(row.entitlement_key) !== true) continue;
      features.push(row.entitlement_key);
    }
    return features;
  }

  /** The kill-switch state the public reads gate on (D8, fails closed). */
  private async flagStates(
    supabase: SupabaseClient<Database>,
  ): Promise<ServiceResult<Map<string, boolean | null>>> {
    const { data, error } = await supabase.from('entitlement_flags').select('key, is_enabled');

    if (error) return toDbFailure(error);

    return success(new Map(dbRows(data).map((row) => [row.key, row.is_enabled])));
  }

  /**
   * `seatEligible` is derived from the plan's entitlement rows and the live
   * catalog embed (D33): a plan with no entitlements is not seat-eligible.
   */
  private static seatEligibilityOf(entitlementRows: readonly PlanEntitlementRead[]): boolean {
    return (
      entitlementRows.length > 0 &&
      entitlementRows.every((row) => !!dbNested(row.entitlement_catalog)?.seat_eligible)
    );
  }

  private toPlanInfo(
    plan: SubscriptionPlanRow,
    entitlementRows: readonly PlanEntitlementRead[],
    limits: Record<string, number>,
    sources: PlanSource[] = [],
    features?: string[],
  ): PlanInfo {
    return {
      id: plan.id,
      key: plan.key,
      name: plan.name,
      description: plan.description ?? null,
      priceMonthly: plan.price_monthly ?? 0,
      priceYearly: plan.price_yearly ?? 0,
      currency: plan.currency,
      sortOrder: plan.sort_order ?? 0,
      isActive: plan.is_active ?? true,
      scope: plan.scope,
      audience: plan.audience ?? null,
      features: features ?? entitlementRows.map((row) => row.entitlement_key),
      seatEligible: SubscriptionPlanService.seatEligibilityOf(entitlementRows),
      limits,
      sources,
    };
  }

  /**
   * Features and limits are keyed by plan, so every single-plan read performs the
   * same two lookups before it can render `PlanInfo`. The entitlement read embeds
   * the catalog's `seat_eligible` flag, so `seatEligible` is database truth, not a
   * TS constant. A public read also reads the kill switch, so it advertises only
   * what the resolver would hand out.
   */
  private async planView(
    supabase: SupabaseClient<Database>,
    plan: SubscriptionPlanRow,
    publicRead = false,
  ): Promise<ServiceResult<PlanInfo>> {
    const { data: planEntitlements, error: pfError } = await supabase
      .from('plan_entitlements')
      .select('entitlement_key, entitlement_catalog(seat_eligible)')
      .eq('plan_key', plan.key);

    if (pfError) return toDbFailure(pfError);

    const rows = dbRows(planEntitlements).map((row) => ({ ...row, plan_key: plan.key }));
    let features: string[] | undefined;
    if (publicRead) {
      const flags = await this.flagStates(supabase);
      if (isFailure(flags)) return flags;
      features = SubscriptionPlanService.advertisedFeatures(rows, flags.data);
    }

    const limitsByPlan = await this.fetchLimitsByPlan([plan.key]);

    return success(this.toPlanInfo(plan, rows, limitsByPlan.get(plan.key) ?? {}, [], features));
  }

  /** Catalog variant: one entitlement read covers every plan in the listing. */
  private async planViews(
    supabase: SupabaseClient<Database>,
    plans: SubscriptionPlanRow[],
    publicRead = false,
  ): Promise<ServiceResult<PlanInfo[]>> {
    const planKeys = plans.map((p) => p.key);

    const { data: planEntitlements, error: pfError } = await supabase
      .from('plan_entitlements')
      .select('plan_key, entitlement_key, entitlement_catalog(seat_eligible)')
      .in('plan_key', planKeys);

    if (pfError) return toDbFailure(pfError);

    const rowsByPlan = new Map<string, PlanEntitlementRead[]>();
    for (const pe of dbRows(planEntitlements)) {
      const rows = rowsByPlan.get(pe.plan_key) ?? [];
      rows.push(pe);
      rowsByPlan.set(pe.plan_key, rows);
    }

    let flagStates: Map<string, boolean | null> | undefined;
    if (publicRead) {
      const flags = await this.flagStates(supabase);
      if (isFailure(flags)) return flags;
      flagStates = flags.data;
    }

    const limitsByPlan = await this.fetchLimitsByPlan(planKeys);

    return success(
      plans.map((p) => {
        const rows = rowsByPlan.get(p.key) ?? [];
        return this.toPlanInfo(
          p,
          rows,
          limitsByPlan.get(p.key) ?? {},
          [],
          flagStates ? SubscriptionPlanService.advertisedFeatures(rows, flagStates) : undefined,
        );
      }),
    );
  }

  /** No filters returns every active plan — the public pricing behaviour (D34). */
  async listActive(filters: PlanCatalogFilters = {}): Promise<ServiceResult<PlanInfo[]>> {
    const supabase = await this.clientFactory();

    let query = supabase.from('subscription_plans').select('*').eq('is_active', true);

    if (filters.scope) {
      query = query.eq('scope', filters.scope);
    }

    const { data: plans, error } = await query.order('sort_order', { ascending: true });

    if (error) return toDbFailure(error);

    // Public read: advertise only what the resolver would grant (#1484).
    return this.planViews(supabase, plans, true);
  }

  /**
   * The caller's current plan (ADR-0015 §6.1/§6.2, phase 3b + 4a/D34).
   *
   * `PlanInfo.key` keeps its historical value for every existing caller
   * (#270/#181/#228): a seated member shows the seat plan, else a member who
   * may bill the active org (`org.billing.manage`; the Admin role holds it)
   * shows the org plan, everyone else their personal plan — all three now
   * membership-verified through the resolver, so a forged `active_org_id`
   * plus a stale seat row can no longer surface a foreign plan. The choice
   * keys on seat/org scope and the billing permission, never on the caller's
   * persona. `features` and `limits` are the **effective** resolved
   * set/limits (`max(org, seat, personal)` for user-scope keys, the org plan
   * for org-scope keys), and `sources` additively carries the union (D28).
   * No field is renamed or removed before phase 6.
   */
  async getMyPlan(ctx: RequestContext): Promise<ServiceResult<PlanInfo>> {
    const supabase = await this.clientFactory();
    const resolved = await entitlementResolver.resolveEntitlements(ctx);

    const { sources } = resolved;
    let planKey: string | null = null;
    if (sources.seat) {
      // Seated member: the seat plan is the effective plan (#270).
      planKey = sources.seat.planKey;
    } else if (sources.org && hasPermission(ctx, Permission.ORG_BILLING_MANAGE)) {
      // Inside a verified org, the member who may bill it sees the org plan
      // (#181); everyone else falls through to the personal plan.
      planKey = sources.org.planKey;
    }
    if (!planKey) {
      planKey = sources.personal?.planKey ?? null;
    }

    if (!planKey) return failure('NOT_FOUND');

    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('key', planKey)
      .maybeSingle();

    if (planError) return toDbFailure(planError);
    if (!plan) return failure('NOT_FOUND');

    // `features`/`limits` are the effective resolved set, not the plan row's
    // own rows; `scope`/`audience`/`seatEligible` still describe the plan.
    const view = await this.planView(supabase, plan);
    if (isFailure(view)) return view;
    return success({
      ...view.data,
      features: resolved.entitlements,
      limits: resolved.limits,
      sources: resolved.plan.sources,
    });
  }

  /**
   * The caller's personal plan (`profiles.personal_plan_key`), returned as
   * stored. The legacy "paid org plan demoted to the free manager plan"
   * fallback is deleted in phase 4a: the migration backfills every manager
   * off organization-scope plans onto the free personal plan, so the stored plan is
   * the answer.
   */
  async getPersonalPlan(ctx: RequestContext): Promise<ServiceResult<PlanInfo>> {
    const supabase = await this.clientFactory();

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', ctx.userId)
      .maybeSingle();

    if (profileError) return toDbFailure(profileError);

    const planKey = profile?.personal_plan_key;
    if (!planKey) return failure('NOT_FOUND');

    const { data: storedPlan, error: planError } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('key', planKey)
      .maybeSingle();

    if (planError) return toDbFailure(planError);
    if (!storedPlan) return failure('NOT_FOUND');

    return this.planView(supabase, storedPlan);
  }

  async getAllAdmin(): Promise<ServiceResult<PlanInfo[]>> {
    const supabase = await this.clientFactory();

    const { data: plans, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) return toDbFailure(error);

    return this.planViews(supabase, plans);
  }

  async getByKey(key: string): Promise<ServiceResult<PlanInfo>> {
    const supabase = await this.clientFactory();

    const { data: plan, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('key', key)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!plan) return failure('NOT_FOUND');

    // Public plan detail: same filter as the list (#1484).
    return this.planView(supabase, plan, true);
  }

  async getById(id: string) {
    const supabase = await this.clientFactory();

    const { data, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return failure('NOT_FOUND');

    return success(data);
  }

  async create(input: CreateSubscriptionPlanInput) {
    const supabase = await this.clientFactory();

    const { data, error } = await supabase
      .from('subscription_plans')
      .insert({
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        price_monthly: input.priceMonthly,
        price_yearly: input.priceYearly,
        sort_order: input.sortOrder,
        is_active: input.isActive,
        currency: input.currency,
        scope: input.scope,
        audience: null,
      })
      .select()
      .single();

    if (error) return toDbFailure(error);

    return success(data);
  }

  async update(id: string, input: UpdateSubscriptionPlanInput) {
    const supabase = await this.clientFactory();

    const updateData: Database['public']['Tables']['subscription_plans']['Update'] = {};
    if (input.key !== undefined) updateData.key = input.key;
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.priceMonthly !== undefined) updateData.price_monthly = input.priceMonthly;
    if (input.priceYearly !== undefined) updateData.price_yearly = input.priceYearly;
    if (input.sortOrder !== undefined) updateData.sort_order = input.sortOrder;
    if (input.isActive !== undefined) updateData.is_active = input.isActive;
    if (input.currency !== undefined) updateData.currency = input.currency;
    if (input.scope !== undefined) updateData.scope = input.scope;
    if (input.audience !== undefined) updateData.audience = input.audience;

    const { data, error } = await supabase
      .from('subscription_plans')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) return toDbFailure(error);

    return success(data);
  }

  async delete(id: string) {
    const supabase = await this.clientFactory();

    const { data: exists } = await supabase
      .from('subscription_plans')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (!exists) return failure('NOT_FOUND');

    const { error } = await supabase.from('subscription_plans').delete().eq('id', id);

    if (error) {
      // profiles.personal_plan_key / organizations.plan still reference this key
      // (both FKs are NO ACTION), so the DB rejects the delete. Report it as a
      // conflict instead of a generic bad request so the admin knows why.
      if (error.code === '23503') return failure('CONFLICT');
      return toDbFailure(error);
    }

    return success({ success: true });
  }
}
export const subscriptionPlanService = wrapService(
  new SubscriptionPlanService(createClient),
  'subscription-plan.service',
);
