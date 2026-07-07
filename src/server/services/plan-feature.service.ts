import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { CreatePlanFeatureInput } from '@/server/models';

export class PlanFeatureService {
  async getAll() {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('plan_features')
      .select('*')
      .order('plan_key', { ascending: true });
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async getByPlanKey(planKey: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('plan_features')
      .select('*')
      .eq('plan_key', planKey);
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async create(input: CreatePlanFeatureInput) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('plan_features')
      .insert({
        plan_key: input.planKey,
        feature_key: input.featureKey,
      })
      .select()
      .single();
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async delete(id: string) {
    const supabase = await createClient();
    const { data: exists } = await supabase
      .from('plan_features')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (!exists) throw new AppError('NOT_FOUND');
    const { error } = await supabase.from('plan_features').delete().eq('id', id);
    if (error) throw mapSupabaseError(error);
    return { success: true };
  }
}

export const planFeatureService = new PlanFeatureService();
