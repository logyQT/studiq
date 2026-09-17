import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  CreatePlanLimitInput,
  UpdatePlanLimitInput,
} from '@studiq/server/models/plan-limit.model';
import type { SupabaseClient } from '@supabase/supabase-js';

export class PlanLimitService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async getByPlanKey(planKey: string): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const { data, error } = await supabase.from('plan_limits').select('*').eq('plan_key', planKey);
    if (error) return toDbFailure(error);
    return success(data);
  }

  async getAll(): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('plan_limits')
      .select('*')
      .order('plan_key', { ascending: true });
    if (error) return toDbFailure(error);
    return success(data);
  }

  async create(input: CreatePlanLimitInput): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('plan_limits')
      .insert({
        plan_key: input.planKey,
        limit_key: input.limitKey,
        limit_value: input.limitValue,
      })
      .select()
      .single();
    if (error) return toDbFailure(error);
    return success(data);
  }

  async update(id: string, input: UpdatePlanLimitInput): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('plan_limits')
      .update({ limit_value: input.limitValue })
      .eq('id', id)
      .select()
      .single();
    if (error) return toDbFailure(error);
    return success(data);
  }

  async delete(id: string): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const { data: exists } = await supabase
      .from('plan_limits')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (!exists) return failure('NOT_FOUND');
    const { error } = await supabase.from('plan_limits').delete().eq('id', id);
    if (error) return toDbFailure(error);
    return success(undefined);
  }
}
export const planLimitService = wrapService(
  new PlanLimitService(createClient),
  'plan-limit.service',
);
