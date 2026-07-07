import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { CreatePlanLimitInput, UpdatePlanLimitInput } from '@/server/models';

export class PlanLimitService {
  async getByPlanKey(planKey: string) {
    const supabase = await createClient();
    const { data, error } = await supabase.from('plan_limits').select('*').eq('plan_key', planKey);
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async getAll() {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('plan_limits')
      .select('*')
      .order('plan_key', { ascending: true });
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async create(input: CreatePlanLimitInput) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('plan_limits')
      .insert({
        plan_key: input.planKey,
        limit_key: input.limitKey,
        limit_value: input.limitValue,
      })
      .select()
      .single();
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async update(id: string, input: UpdatePlanLimitInput) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('plan_limits')
      .update({ limit_value: input.limitValue })
      .eq('id', id)
      .select()
      .single();
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async delete(id: string) {
    const supabase = await createClient();
    const { data: exists } = await supabase
      .from('plan_limits')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (!exists) throw new AppError('NOT_FOUND');
    const { error } = await supabase.from('plan_limits').delete().eq('id', id);
    if (error) throw mapSupabaseError(error);
    return { success: true };
  }
}

export const planLimitService = new PlanLimitService();
