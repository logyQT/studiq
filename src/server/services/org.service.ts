import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';

export class OrgService {
  async listOrgs(ctx: RequestContext) {
    const supabase = await createClient();

    const { data: memberships, error: mError } = await supabase
      .from('org_members')
      .select('organization_id, org_role_id, org_roles(name)')
      .eq('user_id', ctx.userId);

    if (mError) throw mapSupabaseError(mError);

    if (!memberships || memberships.length === 0) {
      return [];
    }

    const orgIds = memberships.map((m: { organization_id: string }) => m.organization_id);

    const { data: orgs, error: oError } = await supabase
      .from('organizations')
      .select('id, name, slug')
      .in('id', orgIds);

    if (oError) throw mapSupabaseError(oError);

    const orgMap = new Map(
      (orgs || []).map((o: { id: string; name: string; slug: string }) => [o.id, o]),
    );

    return memberships.map(
      (m: { organization_id: string; org_role_id: string; org_roles: { name: string }[] }) => {
        const org = orgMap.get(m.organization_id);
        return {
          id: m.organization_id,
          name: org?.name ?? 'Unknown',
          slug: org?.slug ?? '',
          orgRoleName: m.org_roles?.[0]?.name ?? 'member',
          orgRoleId: m.org_role_id,
          isActive: m.organization_id === ctx.activeOrgId,
        };
      },
    );
  }

  async verifyMembership(userId: string, orgId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('NOT_FOUND');

    return data;
  }
}

export const orgService = new OrgService();
