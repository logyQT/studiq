import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { AccountType } from '@/types';

export const FEATURES = ['ai.chat', 'org.manage'] as const;
export type FeatureKey = (typeof FEATURES)[number];

const FEATURE_FLAG_TO_FEATURE_KEY: Record<string, FeatureKey> = {
  ai: 'ai.chat',
  org_manage: 'org.manage',
};

export async function getEnabledFeatures(ctx: RequestContext): Promise<FeatureKey[]> {
  if (ctx.accountType === AccountType.SYS_ADMIN) {
    return Array.from(FEATURES);
  }

  const enabled = new Set<FeatureKey>();
  const supabase = await createClient();

  // 1. Personal plan
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

  // 2. Org plan (union)
  if (ctx.activeOrgId) {
    const { data: org } = await supabase
      .from('organizations')
      .select('plan')
      .eq('id', ctx.activeOrgId)
      .maybeSingle();

    if (org?.plan) {
      const { data: pf } = await supabase
        .from('plan_features')
        .select('feature_key')
        .eq('plan_key', org.plan);
      for (const row of pf ?? []) {
        const mapped = FEATURE_FLAG_TO_FEATURE_KEY[row.feature_key];
        if (mapped) enabled.add(mapped);
      }
    }
  }

  // 3. User overrides (wins)
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

export async function requireFeature(ctx: RequestContext, key: FeatureKey): Promise<void> {
  const enabled = await getEnabledFeatures(ctx);
  if (!enabled.includes(key)) {
    throw new AppError('FORBIDDEN');
  }
}

export async function getEffectiveLimit(ctx: RequestContext, limitKey: string): Promise<number> {
  if (ctx.accountType === AccountType.SYS_ADMIN) return -1;

  const limits: number[] = [];
  const supabase = await createClient();

  // Personal plan
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

  // Org plan (max / more permissive)
  if (ctx.activeOrgId) {
    const { data: org } = await supabase
      .from('organizations')
      .select('plan')
      .eq('id', ctx.activeOrgId)
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
  }

  if (limits.length === 0) return 0;
  if (limits.includes(-1)) return -1;
  return Math.max(...limits);
}

export async function checkLimit(
  ctx: RequestContext,
  limitKey: string,
  currentCount: number,
  increment = 1,
): Promise<void> {
  const limit = await getEffectiveLimit(ctx, limitKey);
  if (limit !== -1 && currentCount + increment > limit) {
    throw new AppError('USAGE_LIMIT_EXCEEDED');
  }
}

export interface UsageInfo {
  current: number;
  limit: number;
  plan: string;
  resetsAt: string;
}

export async function getUsage(ctx: RequestContext, limitKey: string): Promise<UsageInfo> {
  const limit = await getEffectiveLimit(ctx, limitKey);

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

  const { data: profile } = await supabase
    .from('profiles')
    .select('personal_plan_key')
    .eq('id', ctx.userId)
    .maybeSingle();
  const plan = profile?.personal_plan_key ?? 'free';

  return { current, limit, plan, resetsAt };
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
