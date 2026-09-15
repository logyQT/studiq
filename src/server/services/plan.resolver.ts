import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { getSeatPlanKey } from '@/server/services/seat.plan';
import { AccountType } from '@/types';

export interface UsageInfo {
  current: number;
  limit: number;
  plan: string;
  resetsAt: string;
}

export class PlanResolver {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async getEffectiveLimit(ctx: RequestContext, limitKey: string): Promise<number> {
    if (ctx.accountType === AccountType.SYS_ADMIN) return -1;

    const supabase = await this.createClient();

    // In org context: check seat assignment first (Phase 2)
    if (ctx.activeOrgId) {
      const seatPlanKey = await getSeatPlanKey(ctx, supabase);

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
