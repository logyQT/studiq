import type { SupabaseClient } from '@supabase/supabase-js';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';
import type { CreatePlanFeatureInput } from '@/server/models';

export class PlanFeatureService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async getAll(): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('plan_features')
      .select('*')
      .order('plan_key', { ascending: true });
    if (error) return toDbFailure(error);
    return success(data);
  }

  async getByPlanKey(planKey: string): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('plan_features')
      .select('*')
      .eq('plan_key', planKey);
    if (error) return toDbFailure(error);
    return success(data);
  }

  async create(input: CreatePlanFeatureInput): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('plan_features')
      .insert({
        plan_key: input.planKey,
        feature_key: input.featureKey,
      })
      .select()
      .single();
    if (error) return toDbFailure(error);
    return success(data);
  }

  async delete(id: string): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const { data: exists } = await supabase
      .from('plan_features')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (!exists) return failure('NOT_FOUND');
    const { error } = await supabase.from('plan_features').delete().eq('id', id);
    if (error) return toDbFailure(error);
    return success(undefined);
  }
}
