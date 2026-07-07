import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { CreateFeatureFlagInput, UpdateFeatureFlagInput } from '@/server/models';

export class FeatureFlagService {
  async getAll() {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('feature_flags')
      .select('*')
      .order('key', { ascending: true });
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async getById(id: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('feature_flags')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('NOT_FOUND');
    return data;
  }

  async create(input: CreateFeatureFlagInput) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('feature_flags')
      .insert({
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        is_enabled: input.isEnabled ?? true,
        rollout_percentage: input.rolloutPercentage ?? 100,
      })
      .select()
      .single();
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async update(id: string, input: UpdateFeatureFlagInput) {
    const supabase = await createClient();
    const updateData: Record<string, unknown> = {};
    if (input.key !== undefined) updateData.key = input.key;
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.isEnabled !== undefined) updateData.is_enabled = input.isEnabled;
    if (input.rolloutPercentage !== undefined)
      updateData.rollout_percentage = input.rolloutPercentage;

    const { data, error } = await supabase
      .from('feature_flags')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async delete(id: string) {
    const supabase = await createClient();
    const { error } = await supabase.from('feature_flags').delete().eq('id', id);
    if (error) throw mapSupabaseError(error);
    return { success: true };
  }
}

export const featureFlagService = new FeatureFlagService();
