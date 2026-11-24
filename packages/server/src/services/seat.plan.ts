import type { RequestContext } from '@studiq/authz';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbNested } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/**
 * Resolve the plan key a user is entitled to via seat licensing within the
 * active organization. Returns `null` when the user is not seated (no
 * `org_seat_assignments` row), meaning personal/org plan entitlements apply.
 *
 * A failed read is a different answer from "not seated" (#1373): it fails with
 * the mapped database error instead of collapsing to `null`, because the caller
 * would otherwise resolve entitlements and limits from the wrong plan, silently,
 * exactly while the database is unhealthy.
 *
 * One query: the pool's plan key rides the assignment row's `pool_id` FK as an
 * embed. Only ever call this for a membership-verified org — `active_org_id`
 * alone is a client cookie, and a stale seat row must not supply a plan.
 */
export async function getSeatPlanKey(
  ctx: RequestContext,
  supabase: SupabaseClient<Database>,
): Promise<ServiceResult<string | null>> {
  if (!ctx.activeOrgId) return success(null);

  const { data: assignment, error } = await supabase
    .from('org_seat_assignments')
    .select('pool_id, org_seat_pools(plan_key)')
    .eq('organization_id', ctx.activeOrgId)
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (error) return toDbFailure(error);

  return success(dbNested(assignment?.org_seat_pools)?.plan_key ?? null);
}
