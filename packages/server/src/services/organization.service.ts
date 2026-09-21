import type { RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from '@studiq/server/models/organization.model';
import type { SupabaseClient } from '@supabase/supabase-js';

export class OrganizationService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async create(ctx: RequestContext, data: CreateOrganizationInput) {
    const supabase = await this.createClient();

    const { data: organization, error } = await supabase
      .from('organizations')
      .insert({ name: data.name })
      .select()
      .single();

    if (error) return toDbFailure(error);

    const newOrg = organization;

    const defaultGroupName = 'Członkowie';
    const { error: ge } = await supabase.from('groups').insert({
      organization_id: newOrg.id,
      name: defaultGroupName,
      description: null,
      is_default: true,
    });
    if (ge) return toDbFailure(ge);

    const { data: defaultGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('organization_id', newOrg.id)
      .eq('is_default', true)
      .single();
    if (defaultGroup) {
      const { error: me } = await supabase.from('group_members').insert({
        group_id: defaultGroup.id,
        user_id: ctx.userId,
        role: 'teacher',
      });
      if (me) return toDbFailure(me);
    }

    return success(newOrg);
  }

  async createAndJoin(
    ctx: RequestContext,
    data: CreateOrganizationInput,
  ): Promise<ServiceResult<Record<string, unknown>>> {
    const base = await this.create(ctx, data);
    if (!base.success) return base;

    const org = base.data;
    const supabase = await this.createClient();

    const { data: roles, error: rolesError } = await supabase
      .from('org_roles')
      .select('id, name')
      .eq('organization_id', org.id)
      .eq('is_system', true);

    if (rolesError) {
      await supabase.from('organizations').delete().eq('id', org.id);
      return failure('INTERNAL_SERVER');
    }

    const adminRole = roles?.find((r) => r.name === 'admin');
    const teacherRole = roles?.find((r) => r.name === 'teacher');
    const memberRole = roles?.find((r) => r.name === 'member');

    if (!adminRole || !teacherRole || !memberRole) {
      await supabase.from('organizations').delete().eq('id', org.id);
      return failure('INTERNAL_SERVER');
    }

    const { error: memberError } = await supabase.from('org_members').insert({
      organization_id: org.id,
      user_id: ctx.userId,
      org_role_id: adminRole.id,
    });

    if (memberError) {
      await supabase.from('organizations').delete().eq('id', org.id);
      return toDbFailure(memberError);
    }

    const { data: defaultGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('organization_id', org.id)
      .eq('is_default', true)
      .maybeSingle();

    return success({
      ...org,
      adminRoleId: adminRole.id,
      teacherRoleId: teacherRole.id,
      memberRoleId: memberRole.id,
      defaultGroupId: defaultGroup?.id ?? null,
    });
  }

  async getAll() {
    const supabase = await this.createClient();

    const { data: organizations, error } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return toDbFailure(error);

    const orgIds = organizations.map((o: { id: string }) => o.id);

    if (orgIds.length === 0) return success([]);

    const [memberResult, groupResult, roleResult] = await Promise.all([
      supabase.from('org_members').select('organization_id').in('organization_id', orgIds),
      supabase.from('groups').select('organization_id').in('organization_id', orgIds),
      supabase.from('org_roles').select('organization_id').in('organization_id', orgIds),
    ]);

    const memberCounts: Record<string, number> = {};
    for (const m of memberResult.data ?? []) {
      memberCounts[m.organization_id] = (memberCounts[m.organization_id] ?? 0) + 1;
    }

    const groupCounts: Record<string, number> = {};
    for (const g of groupResult.data ?? []) {
      groupCounts[g.organization_id] = (groupCounts[g.organization_id] ?? 0) + 1;
    }

    const roleCounts: Record<string, number> = {};
    for (const r of roleResult.data ?? []) {
      roleCounts[r.organization_id] = (roleCounts[r.organization_id] ?? 0) + 1;
    }

    return success(
      organizations.map((org: { id: string }) => ({
        ...org,
        member_count: memberCounts[org.id] ?? 0,
        group_count: groupCounts[org.id] ?? 0,
        role_count: roleCounts[org.id] ?? 0,
      })),
    );
  }

  async getById(id: string) {
    const supabase = await this.createClient();

    const { data: organization, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !organization) {
      if (error?.code === 'PGRST116') return failure('NOT_FOUND');
      if (error) return toDbFailure(error);
      return failure('NOT_FOUND');
    }

    return success(organization);
  }

  async getByIdWithDetails(id: string) {
    const supabase = await this.createClient();

    const { data: org, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !org) {
      if (error?.code === 'PGRST116') return failure('NOT_FOUND');
      if (error) return toDbFailure(error);
      return failure('NOT_FOUND');
    }

    const [membersResult, groupsResult, rolesResult] = await Promise.all([
      supabase
        .from('org_members')
        .select('user_id, joined_at, profiles!inner(full_name, email), org_roles!inner(name)')
        .eq('organization_id', id)
        .order('joined_at', { ascending: false }),
      supabase.from('groups').select('id, name').eq('organization_id', id).order('name'),
      supabase
        .from('org_roles')
        .select('id, name, description, is_system')
        .eq('organization_id', id)
        .order('is_system', { ascending: false })
        .order('name'),
    ]);

    const roleIds = (rolesResult.data ?? []).map((r: { id: string }) => r.id);
    const permCounts =
      roleIds.length > 0
        ? await supabase
            .from('org_role_permissions')
            .select('org_role_id')
            .in('org_role_id', roleIds)
        : { data: [] as { org_role_id: string }[] };

    const permCountMap: Record<string, number> = {};
    for (const p of permCounts.data ?? []) {
      permCountMap[p.org_role_id] = (permCountMap[p.org_role_id] ?? 0) + 1;
    }

    const groupIds = (groupsResult.data ?? []).map((g: { id: string }) => g.id);
    const groupMembersResult =
      groupIds.length > 0
        ? await supabase.from('group_members').select('group_id, role').in('group_id', groupIds)
        : { data: [] as { group_id: string; role: string }[] };

    const memberCountMap: Record<string, number> = {};
    const teacherCountMap: Record<string, number> = {};
    for (const gm of groupMembersResult.data ?? []) {
      memberCountMap[gm.group_id] = (memberCountMap[gm.group_id] ?? 0) + 1;
      if (gm.role === 'teacher') {
        teacherCountMap[gm.group_id] = (teacherCountMap[gm.group_id] ?? 0) + 1;
      }
    }

    return success({
      ...org,
      members: (membersResult.data ?? []).map((m: Record<string, unknown>) => ({
        id: m.user_id,
        full_name: (m.profiles as Record<string, unknown>).full_name ?? null,
        email: (m.profiles as Record<string, unknown>).email,
        role_name: (m.org_roles as Record<string, unknown>).name,
        joined_at: m.joined_at,
      })),
      groups: (groupsResult.data ?? []).map((g: { id: string; name: string }) => ({
        id: g.id,
        name: g.name,
        member_count: memberCountMap[g.id] ?? 0,
        teacher_count: teacherCountMap[g.id] ?? 0,
      })),
      roles: (rolesResult.data ?? []).map(
        (r: { id: string; name: string; description: string | null; is_system: boolean }) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          is_system: r.is_system,
          permission_count: permCountMap[r.id] ?? 0,
        }),
      ),
    });
  }

  async update(id: string, data: UpdateOrganizationInput) {
    const supabase = await this.createClient();

    const updateData: Partial<CreateOrganizationInput> & {
      logo_url?: string;
      brand_color?: string;
    } = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.logoUrl !== undefined) updateData.logo_url = data.logoUrl;
    if (data.brandColor !== undefined) updateData.brand_color = data.brandColor;

    const { data: organization, error } = await supabase
      .from('organizations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) return toDbFailure(error);

    return success(organization);
  }

  async delete(id: string) {
    const supabase = await this.createClient();

    const { data: exists } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', id)
      .single();

    if (!exists) {
      return failure('NOT_FOUND');
    }

    const { error } = await supabase.from('organizations').delete().eq('id', id);

    if (error) return toDbFailure(error);

    return success({ success: true });
  }
}
export const organizationService = wrapService(
  new OrganizationService(createClient),
  'organization.service',
);
