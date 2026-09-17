import type { RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  CreateSubscriptionPlanInput,
  UpdateSubscriptionPlanInput,
} from '@studiq/server/models/subscription-plan.model';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PlanInfo {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  currency: string;
  features: string[];
  limits: Record<string, number>;
  sortOrder: number;
  isActive: boolean;
}

export class SubscriptionPlanService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  private async fetchLimitsByPlan(
    planKeys: string[],
  ): Promise<Map<string, Record<string, number>>> {
    const supabase = await this.createClient();
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
    plan: Record<string, unknown>,
    features: string[],
    limits: Record<string, number>,
  ): PlanInfo {
    return {
      id: plan.id as string,
      key: plan.key as string,
      name: plan.name as string,
      description: (plan.description as string) ?? null,
      priceMonthly: (plan.price_monthly as number) ?? 0,
      currency: (plan.currency as string) ?? 'PLN',
      sortOrder: (plan.sort_order as number) ?? 0,
      isActive: (plan.is_active as boolean) ?? true,
      features,
      limits,
    };
  }

  async listActive(forAccountType?: string): Promise<ServiceResult<PlanInfo[]>> {
    const supabase = await this.createClient();

    let query = supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .neq('key', 'sysadmin');

    if (forAccountType) {
      query = query.eq('for_account_type', forAccountType);
    }

    const { data: plans, error } = await query.order('sort_order', { ascending: true });

    if (error) return toDbFailure(error);

    const planKeys = plans.map((p) => p.key);

    const { data: planFeatures, error: pfError } = await supabase
      .from('plan_features')
      .select('plan_key, feature_key')
      .in('plan_key', planKeys);

    if (pfError) return toDbFailure(pfError);

    const featuresByPlan = new Map<string, string[]>();
    for (const pf of planFeatures ?? []) {
      if (!featuresByPlan.has(pf.plan_key)) {
        featuresByPlan.set(pf.plan_key, []);
      }
      featuresByPlan.get(pf.plan_key)!.push(pf.feature_key);
    }

    const limitsByPlan = await this.fetchLimitsByPlan(planKeys);

    return success(
      plans.map((p) =>
        this.toPlanInfo(p, featuresByPlan.get(p.key) ?? [], limitsByPlan.get(p.key) ?? {}),
      ),
    );
  }

  async getMyPlan(ctx: RequestContext): Promise<ServiceResult<PlanInfo>> {
    const supabase = await this.createClient();

    let planKey: string | null = null;

    if (ctx.activeOrgId) {
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('plan')
        .eq('id', ctx.activeOrgId)
        .maybeSingle();

      if (orgError) return toDbFailure(orgError);
      if (org) planKey = org.plan;
    }

    if (!planKey) {
      // Fall back to personal plan for standalone users
      const { data: profile } = await supabase
        .from('profiles')
        .select('personal_plan_key')
        .eq('id', ctx.userId)
        .maybeSingle();

      if (profile?.personal_plan_key) {
        planKey = profile.personal_plan_key;
      }
    }

    if (!planKey) return failure('NOT_FOUND');

    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('key', planKey)
      .maybeSingle();

    if (planError) return toDbFailure(planError);
    if (!plan) return failure('NOT_FOUND');

    const { data: planFeatures, error: pfError } = await supabase
      .from('plan_features')
      .select('feature_key')
      .eq('plan_key', plan.key);

    if (pfError) return toDbFailure(pfError);

    const limitsByPlan = await this.fetchLimitsByPlan([plan.key]);

    return success(
      this.toPlanInfo(
        plan,
        planFeatures?.map((pf) => pf.feature_key) ?? [],
        limitsByPlan.get(plan.key) ?? {},
      ),
    );
  }

  async getPersonalPlan(ctx: RequestContext): Promise<ServiceResult<PlanInfo>> {
    const supabase = await this.createClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', ctx.userId)
      .maybeSingle();

    const planKey = profile?.personal_plan_key;
    if (!planKey) return failure('NOT_FOUND');

    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('key', planKey)
      .maybeSingle();

    if (planError) return toDbFailure(planError);
    if (!plan) return failure('NOT_FOUND');

    const { data: planFeatures, error: pfError } = await supabase
      .from('plan_features')
      .select('feature_key')
      .eq('plan_key', plan.key);

    if (pfError) return toDbFailure(pfError);

    const limitsByPlan = await this.fetchLimitsByPlan([plan.key]);

    return success(
      this.toPlanInfo(
        plan,
        planFeatures?.map((pf) => pf.feature_key) ?? [],
        limitsByPlan.get(plan.key) ?? {},
      ),
    );
  }

  async getAllAdmin(): Promise<ServiceResult<PlanInfo[]>> {
    const supabase = await this.createClient();

    const { data: plans, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) return toDbFailure(error);

    const planKeys = plans.map((p) => p.key);

    const { data: planFeatures, error: pfError } = await supabase
      .from('plan_features')
      .select('plan_key, feature_key')
      .in('plan_key', planKeys);

    if (pfError) return toDbFailure(pfError);

    const featuresByPlan = new Map<string, string[]>();
    for (const pf of planFeatures ?? []) {
      if (!featuresByPlan.has(pf.plan_key)) {
        featuresByPlan.set(pf.plan_key, []);
      }
      featuresByPlan.get(pf.plan_key)!.push(pf.feature_key);
    }

    const limitsByPlan = await this.fetchLimitsByPlan(planKeys);

    return success(
      plans.map((p) =>
        this.toPlanInfo(p, featuresByPlan.get(p.key) ?? [], limitsByPlan.get(p.key) ?? {}),
      ),
    );
  }

  async getByKey(key: string): Promise<ServiceResult<PlanInfo>> {
    const supabase = await this.createClient();

    const { data: plan, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('key', key)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!plan) return failure('NOT_FOUND');

    const { data: features, error: pfError } = await supabase
      .from('plan_features')
      .select('feature_key')
      .eq('plan_key', key);

    if (pfError) return toDbFailure(pfError);

    const limitsByPlan = await this.fetchLimitsByPlan([key]);

    return success(
      this.toPlanInfo(plan, features?.map((f) => f.feature_key) ?? [], limitsByPlan.get(key) ?? {}),
    );
  }

  async getById(id: string) {
    const supabase = await this.createClient();

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
    const supabase = await this.createClient();

    const { data, error } = await supabase
      .from('subscription_plans')
      .insert({
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        price_monthly: input.priceMonthly ?? 0,
        price_yearly: input.priceYearly ?? 0,
        sort_order: input.sortOrder ?? 0,
        is_active: input.isActive ?? true,
        currency: input.currency ?? 'PLN',
      })
      .select()
      .single();

    if (error) return toDbFailure(error);

    return success(data);
  }

  async update(id: string, input: UpdateSubscriptionPlanInput) {
    const supabase = await this.createClient();

    const updateData: Record<string, unknown> = {};
    if (input.key !== undefined) updateData.key = input.key;
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.priceMonthly !== undefined) updateData.price_monthly = input.priceMonthly;
    if (input.priceYearly !== undefined) updateData.price_yearly = input.priceYearly;
    if (input.sortOrder !== undefined) updateData.sort_order = input.sortOrder;
    if (input.isActive !== undefined) updateData.is_active = input.isActive;
    if (input.currency !== undefined) updateData.currency = input.currency;

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
    const supabase = await this.createClient();

    const { data: exists } = await supabase
      .from('subscription_plans')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (!exists) return failure('NOT_FOUND');

    const { error } = await supabase.from('subscription_plans').delete().eq('id', id);

    if (error) return toDbFailure(error);

    return success({ success: true });
  }
}
export const subscriptionPlanService = wrapService(
  new SubscriptionPlanService(createClient),
  'subscription-plan.service',
);
