import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
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
  async listActive(): Promise<PlanInfo[]> {
    const supabase = await createClient();

    const { data: plans, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .neq('key', 'sysadmin')
      .order('sort_order', { ascending: true });

    if (error) throw mapSupabaseError(error);

    const planKeys = plans.map((p) => p.key);

    const { data: planFeatures, error: pfError } = await supabase
      .from('plan_features')
      .select('plan_key, feature_key')
      .in('plan_key', planKeys);

    if (pfError) throw mapSupabaseError(pfError);

    const featuresByPlan = new Map<string, string[]>();
    for (const pf of planFeatures ?? []) {
      if (!featuresByPlan.has(pf.plan_key)) {
        featuresByPlan.set(pf.plan_key, []);
      }
      featuresByPlan.get(pf.plan_key)!.push(pf.feature_key);
    }

    return plans.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      priceMonthly: p.price_monthly,
      features: featuresByPlan.get(p.key) ?? [],
    }));
  }

  async getMyPlan(ctx: RequestContext): Promise<PlanInfo> {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('NOT_FOUND');
    }

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('plan')
      .eq('id', ctx.activeOrgId)
      .maybeSingle();

    if (orgError) throw mapSupabaseError(orgError);
    if (!org) throw new AppError('NOT_FOUND');

    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('key', org.plan)
      .maybeSingle();

    if (planError) throw mapSupabaseError(planError);
    if (!plan) throw new AppError('NOT_FOUND');

    const { data: planFeatures, error: pfError } = await supabase
      .from('plan_features')
      .select('feature_key')
      .eq('plan_key', plan.key);

    if (pfError) throw mapSupabaseError(pfError);

    return {
      id: plan.id,
      key: plan.key,
      name: plan.name,
      description: plan.description,
      priceMonthly: plan.price_monthly,
      features: planFeatures?.map((pf) => pf.feature_key) ?? [],
    };
  }

  async getAllAdmin(): Promise<PlanInfo[]> {
    const supabase = await createClient();

    const { data: plans, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) throw mapSupabaseError(error);

    const planKeys = plans.map((p) => p.key);

    const { data: planFeatures, error: pfError } = await supabase
      .from('plan_features')
      .select('plan_key, feature_key')
      .in('plan_key', planKeys);

    if (pfError) throw mapSupabaseError(pfError);

    const featuresByPlan = new Map<string, string[]>();
    for (const pf of planFeatures ?? []) {
      if (!featuresByPlan.has(pf.plan_key)) {
        featuresByPlan.set(pf.plan_key, []);
      }
      featuresByPlan.get(pf.plan_key)!.push(pf.feature_key);
    }

    return plans.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      priceMonthly: p.price_monthly,
      features: featuresByPlan.get(p.key) ?? [],
    }));
  }

  async getById(id: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('NOT_FOUND');

    return data;
  }

  async create(input: CreateSubscriptionPlanInput) {
    const supabase = await createClient();

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

    if (error) throw mapSupabaseError(error);

    return data;
  }

  async update(id: string, input: UpdateSubscriptionPlanInput) {
    const supabase = await createClient();

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

    if (error) throw mapSupabaseError(error);

    return data;
  }

  async delete(id: string) {
    const supabase = await createClient();

    const { data: exists } = await supabase
      .from('subscription_plans')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (!exists) throw new AppError('NOT_FOUND');

    const { error } = await supabase.from('subscription_plans').delete().eq('id', id);

    if (error) throw mapSupabaseError(error);

    return { success: true };
  }
}

export const subscriptionPlanService = new SubscriptionPlanService();
