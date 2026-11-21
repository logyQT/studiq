import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/**
 * Whether the user has an `org_members` row for the organization.
 *
 * `active_org_id` is a client cookie, so only a real membership row makes it a
 * tenant scope: `withAuth` applies the same rule when building the request
 * context, and both resolvers re-verify it so a forged or stale cookie can
 * never widen the tenant scope.
 */
export async function isOrgMember(
  supabase: SupabaseClient<Database>,
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
