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

  private async getSeatPlanKey(ctx: RequestContext): Promise<string | null> {
    if (!ctx.activeOrgId) return null;
    const supabase = await this.createClient();

    const { data: assignment } = await supabase
      .from('org_seat_assignments')
      .select('pool_id')
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', ctx.userId)
      .maybeSingle();

    if (!assignment) return null;

    const { data: pool } = await supabase
      .from('org_seat_pools')
      .select('plan_key')
      .eq('id', assignment.pool_id)
      .maybeSingle();

    return pool?.plan_key ?? null;
  }

  async getEnabledFeatures(ctx: RequestContext): Promise<FeatureKey[]> {
    if (ctx.accountType === AccountType.SYS_ADMIN) {
      return Array.from(FEATURES);
    }

    const enabled = new Set<FeatureKey>();
    const supabase = await this.createClient();

    // In org context: check seat assignment first (Phase 2)
    if (ctx.activeOrgId) {
      const seatPlanKey = await this.getSeatPlanKey(ctx);

      if (seatPlanKey) {
        // Seated user: features come from seat's plan
        const { data: pf } = await supabase
          .from('plan_features')
          .select('feature_key')
          .eq('plan_key', seatPlanKey);
        for (const row of pf ?? []) {
          const mapped = FEATURE_FLAG_TO_FEATURE_KEY[row.feature_key];
          if (mapped) enabled.add(mapped);
        }
      } else if (ctx.orgRoleId) {
        // No seat: fall back to org_role_features (Phase 1)
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
        }
      }
    }

    // Fallback: personal plan (no seat and no org_role_features, or no org context)
    if (enabled.size === 0) {
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

    const supabase = await this.createClient();

    // In org context: check seat assignment first (Phase 2)
    if (ctx.activeOrgId) {
      const seatPlanKey = await this.getSeatPlanKey(ctx);

      if (seatPlanKey) {
        // Seated user: limits come from seat's plan only
        const { data: pl } = await supabase
          .from('plan_limits')
          .select('limit_value')
          .eq('plan_key', seatPlanKey)
          .eq('limit_key', limitKey)
          .maybeSingle();

        return pl?.limit_value ?? 0;
      }
    }

    // No seat (or no org context): personal plan + org override fallback
    const limits: number[] = [];

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

  /**
   * Org-centric limit check: capacity is governed by the organization's plan
   * (plan_limits) plus any org_limits override, never by the acting user's
   * personal plan. Used where the actor is not yet in the org context — e.g.
   * a student accepting an invitation. Missing limits default to unlimited (-1).
   */
  async checkOrgLimit(
    organizationId: string,
    limitKey: string,
    currentCount: number,
    increment = 1,
  ): Promise<void> {
    const supabase = await this.createClient();

    const limits: number[] = [];

    const { data: org } = await supabase
      .from('organizations')
      .select('plan')
      .eq('id', organizationId)
      .maybeSingle();
    if (org?.plan) {
      const { data: pl } = await supabase
        .from('plan_limits')
        .select('limit_value')
        .eq('plan_key', org.plan)
        .eq('limit_key', limitKey)
        .maybeSingle();
      if (pl) limits.push(pl.limit_value);
    }

    const { data: ol } = await supabase
      .from('org_limits')
      .select('max_value')
      .eq('organization_id', organizationId)
      .eq('limit_key', limitKey)
      .maybeSingle();
    if (ol) limits.push(ol.max_value);

    const limit = limits.length === 0 ? -1 : Math.max(...limits);
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
