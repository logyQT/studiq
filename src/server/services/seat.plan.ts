import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@/lib/request-context';

/**
 * Resolve the plan key a user is entitled to via seat licensing within the
 * active organization. Returns `null` when the user is not seated (no
 * `org_seat_assignments` row), meaning personal/org plan entitlements apply.
 *
 * Shared by `FeatureResolver` (features) and `LimitsResolver` (limits) so
 * seat-based entitlements resolve identically in both systems.
 */
export async function getSeatPlanKey(
  ctx: RequestContext,
  supabase: SupabaseClient,
): Promise<string | null> {
  if (!ctx.activeOrgId) return null;

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
