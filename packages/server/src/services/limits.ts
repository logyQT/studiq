import { isLimitKey, type LimitKey, type RequestContext } from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { warn } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import { createClient } from '@studiq/server/lib/supabase/server';
import { entitlementResolver } from '@studiq/server/services/entitlement.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

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
 * The limits surface (ADR-0015 phase 3b): thin wrappers over the single
 * resolver's `limits`, which compose `max(org, seat, personal)` for user-scope
 * keys and the org plan for org-scope keys (§6.2).
 */

/** Effective limit for the caller's current context (§6.2 truth table). */
export async function getEffectiveLimit(ctx: RequestContext, limitKey: LimitKey): Promise<number> {
  if (!isLimitKey(limitKey)) {
    warn('limits: unknown limit key', { limitKey });
    return 0;
  }
  const { limits } = await entitlementResolver.resolveEntitlements(ctx);
  return limits[limitKey] ?? 0;
}

/**
 * Throws `USAGE_LIMIT_EXCEEDED` when `currentCount + increment` passes the
 * effective limit; `-1` is unlimited.
 */
export async function checkLimit(
  ctx: RequestContext,
  limitKey: LimitKey,
  currentCount: number,
  increment = 1,
): Promise<void> {
  const limit = await getEffectiveLimit(ctx, limitKey);
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
export async function checkOrgLimit(
  organizationId: string,
  limitKey: LimitKey,
  currentCount: number,
  increment = 1,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const supabase = client ?? (await createClient());

  const { data: org } = await supabase
    .from('organizations')
    .select('plan')
    .eq('id', organizationId)
    .maybeSingle();
  const orgPlanKey = org?.plan ?? null;
  if (!orgPlanKey) throw new AppError('NOT_FOUND');

  const { data: planLimit } = await supabase
    .from('plan_limits')
    .select('limit_value')
    .eq('plan_key', orgPlanKey)
    .eq('limit_key', limitKey)
    .maybeSingle();

  // A missing row is `0` (blocked) — never unlimited.
  if (!planLimit) {
    warn('limits: plan is missing a limit', { planKey: orgPlanKey, limitKey });
  }
  const limit = planLimit?.limit_value ?? 0;

  if (limit !== -1 && currentCount + increment > limit) {
    throw new AppError('USAGE_LIMIT_EXCEEDED');
  }
}

/**
 * The caller's usage against `limitKey` (read-only). `plan` is the effective
 * primary plan of the resolution (org first, then personal, else `free`) —
 * the union's `sources` ride on `resolveEntitlements` for debugging.
 */
export async function getUsage(ctx: RequestContext, limitKey: LimitKey): Promise<UsageInfo> {
  if (!isLimitKey(limitKey)) {
    warn('limits: unknown limit key', { limitKey });
  }
  const resolved = await entitlementResolver.resolveEntitlements(ctx);
  const limit = isLimitKey(limitKey) ? (resolved.limits[limitKey] ?? 0) : 0;

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const resetsAt = tomorrow.toISOString();

  const supabase = await createClient();
  const { data: activity } = await supabase
    .from('user_daily_activity')
    .select('ai_input_tokens, ai_output_tokens')
    .eq('user_id', ctx.userId)
    .eq('date', today)
    .maybeSingle();

  const current = (activity?.ai_input_tokens ?? 0) + (activity?.ai_output_tokens ?? 0);

  return { current, limit, plan: resolved.plan.primary, resetsAt };
}

export async function trackTokenUsage(
  ctx: RequestContext,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();

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

/** The service-shaped facade over these helpers (`limitsResolver.checkLimit(...)`). */
export const limitsResolver = wrapService(
  {
    checkLimit,
    checkOrgLimit,
    getUsage,
    getEffectiveLimit,
    trackTokenUsage,
  },
  'limits.service',
);
