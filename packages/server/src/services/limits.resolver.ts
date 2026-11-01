import type { RequestContext } from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { warn } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import { createClient } from '@studiq/server/lib/supabase/server';
import { isLimitKey, LIMITS, type LimitKey } from '@studiq/server/services/limit.catalog';
import { personalPlanApplies } from '@studiq/server/services/personal-plan';
import { getSeatPlanKey } from '@studiq/server/services/seat.plan';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface UsageInfo {
  current: number;
  limit: number;
  plan: string;
  resetsAt: string;
}

/**
 * Daily AI token budget (#379). Enforcement (`/api/v1/ai/chat`) and the
 * read-only usage endpoint share this key so the counter always reports the
 * same limit the chat rejects on.
 */
export const AI_TOKENS_LIMIT_KEY: LimitKey = 'max_ai_tokens_per_day';

/**
 * Resolves plan limits for the caller's current context.
 *
 * Rule (#233): org-scope capacity (`scope: 'org'`) always belongs to the
 * organization's plan — no seat and no personal plan can widen it. Per-member
 * keys (`scope: 'user'`) are layered and take the **most permissive** value of
 * the member's personal plan, their seat plan and the org plan, so a plan a
 * member pays for personally is never undercut by an org on the free tier. A
 * missing `plan_limits` row is `0` (blocked) in every path; `-1` is unlimited.
 */
export class LimitsResolver {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  /** Effective limit for the caller's current context (see the class rule). */
  async getEffectiveLimit(ctx: RequestContext, limitKey: LimitKey): Promise<number> {
    const supabase = await this.createClient();

    if (!isLimitKey(limitKey)) {
      warn('limits.resolver: unknown limit key', { limitKey });
      return 0;
    }

    const scope = LIMITS[limitKey].scope;
    const orgId = ctx.activeOrgId;

    if (!orgId) {
      // No org context: personal plan for user-scope keys, no org capacity for
      // org-scope keys.
      return scope === 'org' ? 0 : this.personalLimit(supabase, ctx.userId, limitKey);
    }

    // Per-member keys: a seat and a personally purchased plan both raise them,
    // and the org plan is the floor. Most permissive wins, so an org on the free
    // tier cannot undercut a StudiQ Pro the member bought themselves.
    if (scope === 'user') {
      // Q3 (#233): a seat governs the per-member keys for the seated member.
      const seatPlanKey = await getSeatPlanKey(ctx, supabase);
      if (seatPlanKey) {
        return this.planLimit(supabase, seatPlanKey, limitKey);
      }

      // `active_org_id` is a client cookie: only a real membership is an org
      // context, both for the org floor and for excluding a manager's mirrored
      // personal plan (#228).
      const isOrgMember = await this.isMember(supabase, orgId, ctx.userId);
      const candidates: number[] = personalPlanApplies(ctx, isOrgMember)
        ? [await this.personalLimit(supabase, ctx.userId, limitKey)]
        : [];

      if (isOrgMember) {
        const orgPlanKey = await this.orgPlanKey(supabase, orgId);
        if (orgPlanKey) {
          candidates.push(await this.planLimit(supabase, orgPlanKey, limitKey));
        } else {
          warn('limits.resolver: organization has no plan', { organizationId: orgId, limitKey });
        }
      }

      if (candidates.length === 0) return 0;
      return candidates.includes(-1) ? -1 : Math.max(...candidates);
    }

    // `active_org_id` is a client-controlled cookie: only a real `org_members`
    // row makes it a tenant scope. A forged/stale id grants no org capacity.
    if (!(await this.isMember(supabase, orgId, ctx.userId))) {
      return 0;
    }

    const orgPlanKey = await this.orgPlanKey(supabase, orgId);
    if (!orgPlanKey) {
      warn('limits.resolver: organization has no plan', { organizationId: orgId, limitKey });
      return 0;
    }

    return this.planLimit(supabase, orgPlanKey, limitKey);
  }

  async checkLimit(
    ctx: RequestContext,
    limitKey: LimitKey,
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
   * (organizations.plan → plan_limits), never by the acting user's personal
   * plan or a seat. Used where the actor is not yet in the org context — e.g. a
   * student accepting an invitation. A missing `plan_limits` row is `0`
   * (blocked); an unknown organization is `NOT_FOUND`.
   *
   * Deliberately has **no** ctx-membership gate: it takes an explicit
   * organization id and runs before membership exists (invite accept), so the
   * caller passes the service-role client (#182/#191).
   *
   * `client` lets the caller pass the service-role client: before the caller is
   * an org member, RLS hides `organizations`, which would silently turn every
   * limit into "unlimited" (#182 regression).
   */
  async checkOrgLimit(
    organizationId: string,
    limitKey: LimitKey,
    currentCount: number,
    increment = 1,
    client?: SupabaseClient,
  ): Promise<void> {
    const supabase = client ?? (await this.createClient());

    const orgPlanKey = await this.orgPlanKey(supabase, organizationId);
    if (!orgPlanKey) throw new AppError('NOT_FOUND');

    const limit = await this.planLimit(supabase, orgPlanKey, limitKey);
    if (limit !== -1 && currentCount + increment > limit) {
      throw new AppError('USAGE_LIMIT_EXCEEDED');
    }
  }

  async getUsage(ctx: RequestContext, limitKey: LimitKey): Promise<UsageInfo> {
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

  /** `profiles.personal_plan_key` → `plan_limits`; a missing plan blocks (`0`). */
  private async personalLimit(
    supabase: SupabaseClient,
    userId: string,
    limitKey: LimitKey,
  ): Promise<number> {
    const { data: profile } = await supabase
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', userId)
      .maybeSingle();

    const planKey = profile?.personal_plan_key;
    if (!planKey) {
      warn('limits.resolver: profile has no personal plan', { userId, limitKey });
      return 0;
    }

    return this.planLimit(supabase, planKey, limitKey);
  }

  /** `organizations.plan` for the given org, or `null` when the org is unknown. */
  private async orgPlanKey(
    supabase: SupabaseClient,
    organizationId: string,
  ): Promise<string | null> {
    const { data: org } = await supabase
      .from('organizations')
      .select('plan')
      .eq('id', organizationId)
      .maybeSingle();

    return org?.plan ?? null;
  }

  private async isMember(
    supabase: SupabaseClient,
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    const { data: membership } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();

    return membership != null;
  }

  /** One plan's value for a key. A missing row is `0` (blocked) — never unlimited. */
  private async planLimit(
    supabase: SupabaseClient,
    planKey: string,
    limitKey: LimitKey,
  ): Promise<number> {
    const { data: planLimit } = await supabase
      .from('plan_limits')
      .select('limit_value')
      .eq('plan_key', planKey)
      .eq('limit_key', limitKey)
      .maybeSingle();

    if (!planLimit) {
      warn('limits.resolver: plan is missing a limit', { planKey, limitKey });
      return 0;
    }

    return planLimit.limit_value;
  }
}
export const limitsResolver = wrapService(
  new LimitsResolver(createClient),
  'limits-resolver.service',
);
