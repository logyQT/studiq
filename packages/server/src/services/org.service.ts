import type { RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';

export class OrgService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async listOrgs(ctx: RequestContext): Promise<
    ServiceResult<
      {
        id: string;
        name: string;
        orgRoleName: string;
        orgRoleId: string;
        isActive: boolean;
        logo_url: string | null;
        brand_color: string | null;
      }[]
    >
  > {
    const supabase = await this.createClient();

    const { data: memberships, error: mError } = await supabase
      .from('org_members')
      .select('organization_id, org_role_id, org_roles(name, display_name)')
      .eq('user_id', ctx.userId);

    if (mError) return toDbFailure(mError);

    if (!memberships || memberships.length === 0) {
      return success([]);
    }

    const orgIds = memberships.map((m) => m.organization_id);

    // logo_url/brand_color ride along so the navbar can render org branding
    // without a second request (issue #108).
    const { data: orgs, error: oError } = await supabase
      .from('organizations')
      .select('id, name, logo_url, brand_color')
      .in('id', orgIds);

    if (oError) return toDbFailure(oError);

    const orgMap = new Map((orgs || []).map((o) => [o.id, o]));

    return success(
      memberships.map((m) => {
        const roles = Array.isArray(m.org_roles) ? m.org_roles : [m.org_roles];
        const org = orgMap.get(m.organization_id);
        const roleName = roles[0]?.name ?? 'member';
        return {
          id: m.organization_id,
          name: org?.name ?? 'Unknown',
          orgRoleName: roleName,
          orgRoleDisplayName: roles[0]?.display_name ?? roleName,
          orgRoleId: m.org_role_id,
          isActive: m.organization_id === ctx.activeOrgId,
          logo_url: org?.logo_url ?? null,
          brand_color: org?.brand_color ?? null,
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
export const orgService = wrapService(new OrgService(createClient), 'org.service');
