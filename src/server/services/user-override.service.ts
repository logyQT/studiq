import { AppError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type {
  CreateUserFeatureOverrideInput,
  UpdateUserFeatureOverrideInput,
} from '@/server/models';

export class UserOverrideService {
  async getAll() {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('user_feature_overrides')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async getById(id: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('user_feature_overrides')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('NOT_FOUND');
    return data;
  }

  async create(input: CreateUserFeatureOverrideInput) {
    const supabase = await createClient();
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
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async update(id: string, input: UpdateUserFeatureOverrideInput) {
    const supabase = await createClient();
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
    if (error) throw mapSupabaseError(error);
    return data;
  }

  async delete(id: string) {
    const supabase = await createClient();
    const { data: exists } = await supabase
      .from('user_feature_overrides')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (!exists) throw new AppError('NOT_FOUND');
    const { error } = await supabase.from('user_feature_overrides').delete().eq('id', id);
    if (error) throw mapSupabaseError(error);
    return { success: true };
  }
}

export const userOverrideService = new UserOverrideService();
