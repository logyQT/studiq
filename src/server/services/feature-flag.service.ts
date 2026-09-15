import type { SupabaseClient } from '@supabase/supabase-js';
import { wrapService } from '@/lib/observability';
import { failure, success } from '@/lib/service-result';
import { createClient } from '@/lib/supabase/server';
import { toDbFailure } from '@/lib/supabase-errors';
import type {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
} from '@/server/models/feature-flag.model';

export class FeatureFlagService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async getAll() {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('feature_flags')
      .select('*')
      .order('key', { ascending: true });
    if (error) return toDbFailure(error);
    return success(data);
  }

  async getById(id: string) {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('feature_flags')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return toDbFailure(error);
    if (!data) return failure('NOT_FOUND');
    return success(data);
  }

  async create(input: CreateFeatureFlagInput) {
    const supabase = await this.createClient();
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
    if (error) return toDbFailure(error);
    return success(data);
  }

  async update(id: string, input: UpdateFeatureFlagInput) {
    const supabase = await this.createClient();
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
    if (error) return toDbFailure(error);
    return success(data);
  }

  async delete(id: string) {
    const supabase = await this.createClient();
    const { error } = await supabase.from('feature_flags').delete().eq('id', id);
    if (error) return toDbFailure(error);
    return success({ success: true });
  }
}
export const featureFlagService = wrapService(
  new FeatureFlagService(createClient),
  'feature-flag.service',
);
