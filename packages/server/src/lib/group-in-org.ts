import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { failure, success, type ServiceResult } from '@studiq/server/lib/service-result';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

export interface GroupInOrgRow {
  id: string;
  organization_id: string;
  created_by: string | null;
}

/**
 * Resolve ONE group inside ONE organization (the caller's active org for a
 * request context). The lookup is scoped to the organization, so an unknown id
 * and a group of another org are the same NOT_FOUND — a caller never learns
 * whether a foreign tenant has it (ADR-0015 §7.1). `created_by` is selected
 * because the `own`/creator branch of `resolveGroupScope` needs it.
 */
export async function groupInOrg(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  groupId: string,
): Promise<ServiceResult<GroupInOrgRow>> {
  const { data: group, error } = await supabase
    .from('groups')
    .select('id, organization_id, created_by')
    .eq('id', groupId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) return toDbFailure(error);
  return group ? success(group) : failure('NOT_FOUND');
}
