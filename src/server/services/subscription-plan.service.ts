import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';
import type { CreateSubscriptionPlanInput, UpdateSubscriptionPlanInput } from '@/server/models';

export interface PlanInfo {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  features: string[];
}

export class SubscriptionPlanService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async listActive(): Promise<ServiceResult<PlanInfo[]>> {
    const supabase = await this.createClient();

    const { data: plans, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .neq('key', 'sysadmin')
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

    return success(
      plans.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        description: p.description,
        priceMonthly: p.price_monthly,
        features: featuresByPlan.get(p.key) ?? [],
      })),
    );
  }

  async getMyPlan(ctx: RequestContext): Promise<ServiceResult<PlanInfo>> {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('NOT_FOUND');
    }

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('plan')
      .eq('id', ctx.activeOrgId)
      .maybeSingle();

    if (orgError) return toDbFailure(orgError);
    if (!org) return failure('NOT_FOUND');

    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('key', org.plan)
      .maybeSingle();

    if (planError) return toDbFailure(planError);
    if (!plan) return failure('NOT_FOUND');

    const { data: planFeatures, error: pfError } = await supabase
      .from('plan_features')
      .select('feature_key')
      .eq('plan_key', plan.key);

    if (pfError) return toDbFailure(pfError);

    return success({
      id: plan.id,
      key: plan.key,
      name: plan.name,
      description: plan.description,
      priceMonthly: plan.price_monthly,
      features: planFeatures?.map((pf) => pf.feature_key) ?? [],
    });
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

    return success(
      plans.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        description: p.description,
        priceMonthly: p.price_monthly,
        features: featuresByPlan.get(p.key) ?? [],
      })),
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
