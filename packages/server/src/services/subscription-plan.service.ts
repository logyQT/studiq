import { AccountType, type PlanSource, type RequestContext } from '@studiq/authz';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
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
  forAccountType: string | null;
}

type SubscriptionPlanRow = Database['public']['Tables']['subscription_plans']['Row'];

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

  private toPlanInfo(
    plan: SubscriptionPlanRow,
    features: string[],
    limits: Record<string, number>,
    sources: PlanSource[] = [],
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
      forAccountType: plan.for_account_type ?? null,
      features,
      limits,
      sources,
    };
  }

  /**
   * Features and limits are keyed by plan, so every single-plan read performs the
   * same two lookups before it can render `PlanInfo`.
   */
  private async planView(
    supabase: SupabaseClient<Database>,
    plan: SubscriptionPlanRow,
  ): Promise<ServiceResult<PlanInfo>> {
    const { data: planEntitlements, error: pfError } = await supabase
      .from('plan_entitlements')
      .select('entitlement_key')
      .eq('plan_key', plan.key);

    if (pfError) return toDbFailure(pfError);

    const limitsByPlan = await this.fetchLimitsByPlan([plan.key]);

    return success(
      this.toPlanInfo(
        plan,
        dbRows(planEntitlements).map((pe) => pe.entitlement_key),
        limitsByPlan.get(plan.key) ?? {},
      ),
    );
  }

  /** Catalog variant: one features read covers every plan in the listing. */
  private async planViews(
    supabase: SupabaseClient<Database>,
    plans: SubscriptionPlanRow[],
  ): Promise<ServiceResult<PlanInfo[]>> {
    const planKeys = plans.map((p) => p.key);

    const { data: planEntitlements, error: pfError } = await supabase
      .from('plan_entitlements')
      .select('plan_key, entitlement_key')
      .in('plan_key', planKeys);

    if (pfError) return toDbFailure(pfError);

    const featuresByPlan = new Map<string, string[]>();
    for (const pe of dbRows(planEntitlements)) {
      if (!featuresByPlan.has(pe.plan_key)) {
        featuresByPlan.set(pe.plan_key, []);
      }
      featuresByPlan.get(pe.plan_key)!.push(pe.entitlement_key);
    }

    const limitsByPlan = await this.fetchLimitsByPlan(planKeys);

    return success(
      plans.map((p) =>
        this.toPlanInfo(p, featuresByPlan.get(p.key) ?? [], limitsByPlan.get(p.key) ?? {}),
      ),
    );
  }

  async listActive(forAccountType?: string): Promise<ServiceResult<PlanInfo[]>> {
    const supabase = await this.clientFactory();

    let query = supabase.from('subscription_plans').select('*').eq('is_active', true);

    if (forAccountType) {
      query = query.eq('for_account_type', forAccountType);
    }

    const { data: plans, error } = await query.order('sort_order', { ascending: true });

    if (error) return toDbFailure(error);

    return this.planViews(supabase, plans);
  }

  /**
   * The caller's current plan (ADR-0015 §6.1/§6.2, phase 3b).
   *
   * `PlanInfo.key` keeps its historical value for every existing caller
   * (#270/#181/#228): a seated student/educator shows the seat plan, a manager
   * shows the active org's plan, everyone else their personal plan — all three
   * now membership-verified through the resolver, so a forged `active_org_id`
   * plus a stale seat row can no longer surface a foreign plan. `features` and
   * `limits` are the **effective** resolved set/limits (`max(org, seat,
   * personal)` for user-scope keys, the org plan for org-scope keys), and
   * `sources` additively carries the union (D28). No field is renamed or
   * removed before phase 6.
   */
  async getMyPlan(ctx: RequestContext): Promise<ServiceResult<PlanInfo>> {
    const supabase = await this.clientFactory();
    const resolved = await entitlementResolver.resolveEntitlements(ctx);

    const { sources } = resolved;
    let planKey: string | null = null;
    if (sources.seat && ctx.accountType !== AccountType.MANAGER) {
      // Seated member (student/educator): the seat plan is the effective plan
      // (#270). Managers keep resolving the org plan because they are the
      // org's billing contact (#181).
      planKey = sources.seat.planKey;
    } else if (sources.org && ctx.accountType === AccountType.MANAGER) {
      planKey = sources.org.planKey;
    }
    if (!planKey) {
      // Unseated non-managers, and a manager whose `active_org_id` is not a
      // verified membership. Inside a verified org a manager always has
      // `sources.org` (`organizations.plan` is NOT NULL) and personal never
      // applies, so no in-org manager reaches this line.
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

    return success(
      this.toPlanInfo(plan, resolved.entitlements, resolved.limits, resolved.plan.sources),
    );
  }

  /**
   * The caller's personal plan (`profiles.personal_plan_key`).
   *
   * Managers have no paid personal plan (#228): an organization purchase never
   * writes the buyer's personal plan, and a manager's personal plan is the free
   * `launch` tier used only outside an organization. Rows written by checkout
   * before that invariant existed may still hold a paid organization plan; they
   * are reported as the free manager plan instead of the org plan they were
   * copied from.
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

    // A manager's personal plan is never an organization plan (#228). Legacy
    // rows that still point at a paid manager plan resolve to the free manager
    // tier (`launch` in the seed catalog) instead of the org plan they were
    // copied from. Everyone else gets the stored plan verbatim.
    let plan = storedPlan;
    const isPaidOrgPlan =
      storedPlan.for_account_type === 'manager' && (storedPlan.price_monthly ?? 0) > 0;
    if (ctx.accountType === AccountType.MANAGER && isPaidOrgPlan) {
      const { data: freeManagerPlan, error: freePlanError } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('for_account_type', 'manager')
        .eq('price_monthly', 0)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (freePlanError) return toDbFailure(freePlanError);
      if (!freeManagerPlan) return failure('NOT_FOUND');
      plan = freeManagerPlan;
    }

    return this.planView(supabase, plan);
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

    return this.planView(supabase, plan);
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
        for_account_type: input.forAccountType ?? null,
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
    if (input.forAccountType !== undefined) updateData.for_account_type = input.forAccountType;

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
