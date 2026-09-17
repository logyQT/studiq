import { createClient } from '@admin/lib/supabase/admin-client';
import type { CreatePlanFeatureInput } from '@admin/server/models/plan-feature.model';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';

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
export const planFeatureService = wrapService(
  new PlanFeatureService(createClient),
  'plan-feature.service',
);
