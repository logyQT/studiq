import type { RequestContext } from '@studiq/authz';
import { dbNested } from '@studiq/server/lib/supabase/rows';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/**
 * Resolve the plan key a user is entitled to via seat licensing within the
 * active organization. Returns `null` when the user is not seated (no
 * `org_seat_assignments` row), meaning personal/org plan entitlements apply.
 *
 * One query: the pool's plan key rides the assignment row's `pool_id` FK as an
 * embed. Only ever call this for a membership-verified org — `active_org_id`
 * alone is a client cookie, and a stale seat row must not supply a plan.
 */
export async function getSeatPlanKey(
  ctx: RequestContext,
  supabase: SupabaseClient<Database>,
): Promise<string | null> {
  if (!ctx.activeOrgId) return null;

  const { data: assignment } = await supabase
    .from('org_seat_assignments')
    .select('pool_id, org_seat_pools(plan_key)')
    .eq('organization_id', ctx.activeOrgId)
    .eq('user_id', ctx.userId)
    .maybeSingle();

  return dbNested(assignment?.org_seat_pools)?.plan_key ?? null;
}
