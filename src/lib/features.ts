import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';

export const FEATURES = ['ai.chat', 'org.manage'] as const;
export type FeatureKey = (typeof FEATURES)[number];

export const DEFAULT_ROLE_FEATURES: Record<string, FeatureKey[]> = {
  student: ['ai.chat'],
  educator: ['ai.chat', 'org.manage'],
  manager: ['ai.chat', 'org.manage'],
};

export async function getEnabledFeatures(ctx: RequestContext): Promise<FeatureKey[]> {
  const base = DEFAULT_ROLE_FEATURES[ctx.accountType] ?? [];
  const features = new Set<FeatureKey>(base);

  const supabase = await createClient();
  const { data: overrides } = await supabase
    .from('user_feature_overrides')
    .select('feature_key, is_enabled')
    .eq('user_id', ctx.userId);

  for (const row of overrides ?? []) {
    const key = row.feature_key as FeatureKey;
    if (row.is_enabled) {
      features.add(key);
    } else {
      features.delete(key);
    }
  }

  return Array.from(features);
}

export async function requireFeature(ctx: RequestContext, key: FeatureKey): Promise<void> {
  const enabledFeatures = await getEnabledFeatures(ctx);
  if (!enabledFeatures.includes(key)) {
    throw new AppError('FORBIDDEN');
  }
}
