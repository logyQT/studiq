import type {
  CreateUserFeatureOverrideInput,
  UpdateUserFeatureOverrideInput,
} from '@admin/server/models/user-feature-override.model';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';

export class UserOverrideService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async getAll() {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('user_feature_overrides')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return toDbFailure(error);
    return success(data);
  }

  async getById(id: string) {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('user_feature_overrides')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return toDbFailure(error);
    if (!data) return failure('NOT_FOUND');
    return success(data);
  }

  async create(input: CreateUserFeatureOverrideInput) {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('user_feature_overrides')
      .insert({
        user_id: input.userId,
        feature_key: input.featureKey,
        is_enabled: input.isEnabled,
        reason: input.reason ?? null,
        expires_at: input.expiresAt ?? null,
      })
      .select()
      .single();
    if (error) return toDbFailure(error);
    return success(data);
  }

  async update(id: string, input: UpdateUserFeatureOverrideInput) {
    const supabase = await this.createClient();
    const updateData: Record<string, unknown> = {};
    if (input.isEnabled !== undefined) updateData.is_enabled = input.isEnabled;
    if (input.reason !== undefined) updateData.reason = input.reason;
    if (input.expiresAt !== undefined) updateData.expires_at = input.expiresAt;

    const { data, error } = await supabase
      .from('user_feature_overrides')
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
      .from('user_feature_overrides')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (!exists) return failure('NOT_FOUND');
    const { error } = await supabase.from('user_feature_overrides').delete().eq('id', id);
    if (error) return toDbFailure(error);
    return success({ success: true });
  }
}
export const userOverrideService = wrapService(
  new UserOverrideService(createClient),
  'user-override.service',
);
