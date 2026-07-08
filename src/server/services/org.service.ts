import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';

export class OrgService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async listOrgs(
    ctx: RequestContext,
  ): Promise<
    ServiceResult<
      { id: string; name: string; orgRoleName: string; orgRoleId: string; isActive: boolean }[]
    >
  > {
    const supabase = await this.createClient();

    const { data: memberships, error: mError } = await supabase
      .from('org_members')
      .select('organization_id, org_role_id, org_roles(name)')
      .eq('user_id', ctx.userId);

    if (mError) return toDbFailure(mError);

    if (!memberships || memberships.length === 0) {
      return success([]);
    }

    const orgIds = memberships.map((m) => m.organization_id);

    const { data: orgs, error: oError } = await supabase
      .from('organizations')
      .select('id, name')
      .in('id', orgIds);

    if (oError) return toDbFailure(oError);

    const orgMap = new Map((orgs || []).map((o) => [o.id, o]));

    return success(
      memberships.map((m) => {
        const roles = Array.isArray(m.org_roles) ? m.org_roles : [m.org_roles];
        const org = orgMap.get(m.organization_id);
        return {
          id: m.organization_id,
          name: org?.name ?? 'Unknown',
          orgRoleName: roles[0]?.name ?? 'member',
          orgRoleId: m.org_role_id,
          isActive: m.organization_id === ctx.activeOrgId,
        };
      }),
    );
  }

  async verifyMembership(
    userId: string,
    orgId: string,
  ): Promise<ServiceResult<{ organization_id: string }>> {
    const supabase = await this.createClient();

    const { data, error } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return failure('NOT_FOUND');

    return success(data);
  }
}
