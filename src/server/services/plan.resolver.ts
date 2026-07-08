import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { AccountType } from '@/types';

export const FEATURES = ['ai.chat', 'group.manage', 'member.manage', 'role.builder'] as const;
export type FeatureKey = (typeof FEATURES)[number];

export interface UsageInfo {
  current: number;
  limit: number;
  plan: string;
  resetsAt: string;
}

const FEATURE_FLAG_TO_FEATURE_KEY: Record<string, FeatureKey> = {
  ai: 'ai.chat',
  group_manage: 'group.manage',
  member_manage: 'member.manage',
  role_builder: 'role.builder',
};

export class PlanResolver {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async getEnabledFeatures(ctx: RequestContext): Promise<FeatureKey[]> {
    if (ctx.accountType === AccountType.SYS_ADMIN) {
      return Array.from(FEATURES);
    }

    const enabled = new Set<FeatureKey>();
    const supabase = await this.createClient();

    // In org context with a role: check org_role_features first
    if (ctx.activeOrgId && ctx.orgRoleId) {
      const { data: roleFeatures } = await supabase
        .from('org_role_features')
        .select('feature_key, is_enabled')
        .eq('org_role_id', ctx.orgRoleId);

      if (roleFeatures && roleFeatures.length > 0) {
        for (const row of roleFeatures) {
          const mapped = FEATURE_FLAG_TO_FEATURE_KEY[row.feature_key];
          if (mapped && row.is_enabled) {
            enabled.add(mapped);
          }
        }
        // Org_role_features are authoritative — return them
        return Array.from(enabled);
      }
      // Empty org_role_features → fall through to personal plan fallback
    }

    // Fallback: personal plan (also used when not in org context)
    const { data: profile } = await supabase
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', ctx.userId)
      .maybeSingle();

    if (profile?.personal_plan_key) {
      const { data: pf } = await supabase
        .from('plan_features')
        .select('feature_key')
        .eq('plan_key', profile.personal_plan_key);
      for (const row of pf ?? []) {
        const mapped = FEATURE_FLAG_TO_FEATURE_KEY[row.feature_key];
        if (mapped) enabled.add(mapped);
      }
    }

    // User overrides always apply on top
    const { data: overrides } = await supabase
      .from('user_feature_overrides')
      .select('feature_key, is_enabled')
      .eq('user_id', ctx.userId);

    for (const row of overrides ?? []) {
      const mapped = FEATURE_FLAG_TO_FEATURE_KEY[row.feature_key];
      if (mapped) {
        if (row.is_enabled) {
          enabled.add(mapped);
        } else {
          enabled.delete(mapped);
        }
      }
    }

    return Array.from(enabled);
  }

  async requireFeature(
    ctx: RequestContext,
    key: FeatureKey,
  ): Promise<ServiceResult<void, 'FORBIDDEN'>> {
    const enabled = await this.getEnabledFeatures(ctx);
    if (!enabled.includes(key)) {
      return failure('FORBIDDEN');
    }
    return success(undefined);
  }

  async getEffectiveLimit(ctx: RequestContext, limitKey: string): Promise<number> {
    if (ctx.accountType === AccountType.SYS_ADMIN) return -1;

    const limits: number[] = [];
    const supabase = await this.createClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', ctx.userId)
      .maybeSingle();

    if (profile?.personal_plan_key) {
      const { data: pl } = await supabase
        .from('plan_limits')
        .select('limit_value')
        .eq('plan_key', profile.personal_plan_key)
        .eq('limit_key', limitKey)
        .maybeSingle();
      if (pl) limits.push(pl.limit_value);
    }

    if (ctx.activeOrgId) {
      const { data: ol } = await supabase
        .from('org_limits')
        .select('max_value')
        .eq('organization_id', ctx.activeOrgId)
        .eq('limit_key', limitKey)
        .maybeSingle();
      if (ol) limits.push(ol.max_value);
    }

    if (limits.length === 0) return 0;
    if (limits.includes(-1)) return -1;
    return Math.max(...limits);
  }

  async checkLimit(
    ctx: RequestContext,
    limitKey: string,
    currentCount: number,
    increment = 1,
  ): Promise<void> {
    const limit = await this.getEffectiveLimit(ctx, limitKey);
    if (limit !== -1 && currentCount + increment > limit) {
      throw new AppError('USAGE_LIMIT_EXCEEDED');
    }
  }

  async getUsage(ctx: RequestContext, limitKey: string): Promise<UsageInfo> {
    const limit = await this.getEffectiveLimit(ctx, limitKey);

    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    const resetsAt = tomorrow.toISOString();

    const supabase = await this.createClient();
    const { data: activity } = await supabase
      .from('user_daily_activity')
      .select('ai_input_tokens, ai_output_tokens')
      .eq('user_id', ctx.userId)
      .eq('date', today)
      .maybeSingle();

    const current = (activity?.ai_input_tokens ?? 0) + (activity?.ai_output_tokens ?? 0);

    const { data: profile } = await supabase
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', ctx.userId)
      .maybeSingle();
    const plan = profile?.personal_plan_key ?? 'free';

    return { current, limit, plan, resetsAt };
  }

  async trackTokenUsage(
    ctx: RequestContext,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const supabase = await this.createClient();

    const { data: existing } = await supabase
      .from('user_daily_activity')
      .select('ai_input_tokens, ai_output_tokens')
      .eq('user_id', ctx.userId)
      .eq('date', today)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('user_daily_activity')
        .update({
          ai_input_tokens: existing.ai_input_tokens + inputTokens,
          ai_output_tokens: existing.ai_output_tokens + outputTokens,
        })
        .eq('user_id', ctx.userId)
        .eq('date', today);
    } else {
      await supabase.from('user_daily_activity').insert({
        user_id: ctx.userId,
        date: today,
        ai_input_tokens: inputTokens,
        ai_output_tokens: outputTokens,
      });
    }
  }
}
