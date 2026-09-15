import type { RequestContext } from '@studiq/authz';
import type { SupabaseClient } from '@supabase/supabase-js';
import { wrapService } from '@/lib/observability';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { createClient } from '@/lib/supabase/server';
import { toDbFailure } from '@/lib/supabase-errors';
import type {
  CreateOrgRoleInput,
  SetRolePermissionsInput,
  UpdateOrgRoleInput,
} from '@/server/models/org-role.model';

export class OrgRoleService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async listRoles(ctx: RequestContext): Promise<
    ServiceResult<
      {
        id: string;
        name: string;
        description: string | null;
        isSystem: boolean;
        memberCount: number;
        permissionCount: number;
      }[]
    >
  > {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data, error } = await supabase
      .from('org_roles')
      .select(
        `
        id, name, display_name, description, is_system,
        org_members:org_members(count),
        org_role_permissions:org_role_permissions(count)
      `,
      )
      .eq('organization_id', ctx.activeOrgId)
      .order('name');

    if (error) return toDbFailure(error);

    return success(
      (data ?? []).map((r) => {
        const memberCount = (r.org_members as unknown as { count: number }[])?.[0]?.count ?? 0;
        const permissionCount =
          (r.org_role_permissions as unknown as { count: number }[])?.[0]?.count ?? 0;
        return {
          id: r.id,
          name: r.name,
          displayName: r.display_name,
          description: r.description,
          isSystem: r.is_system,
          memberCount,
          permissionCount,
        };
      }),
    );
  }

  async getRole(
    ctx: RequestContext,
    id: string,
  ): Promise<
    ServiceResult<{
      id: string;
      name: string;
      description: string | null;
      isSystem: boolean;
      permissions: { permissionName: string; scope: string }[];
    }>
  > {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data, error } = await supabase
      .from('org_roles')
      .select(
        `
        id, name, display_name, description, is_system,
        org_role_permissions(permission_name, scope)
      `,
      )
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (error) return toDbFailure(error);

    return success({
      id: data.id,
      name: data.name,
      displayName: data.display_name,
      description: data.description,
      isSystem: data.is_system,
      permissions:
        (data.org_role_permissions as unknown as { permission_name: string; scope: string }[])?.map(
          (p) => ({ permissionName: p.permission_name, scope: p.scope }),
        ) ?? [],
    });
  }

  async createRole(
    ctx: RequestContext,
    data: CreateOrgRoleInput,
  ): Promise<
    ServiceResult<{ id: string; name: string; description: string | null; isSystem: boolean }>
  > {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data: role, error } = await supabase
      .from('org_roles')
      .insert({
        organization_id: ctx.activeOrgId,
        name: data.name,
        display_name: data.name,
        description: data.description ?? null,
        is_system: false,
      })
      .select('id, name, display_name, description, is_system')
      .single();

    if (error) return toDbFailure(error);

    return success({
      id: role.id,
      name: role.name,
      displayName: role.display_name,
      description: role.description,
      isSystem: role.is_system,
    });
  }

  async updateRole(
    ctx: RequestContext,
    id: string,
    data: UpdateOrgRoleInput,
  ): Promise<
    ServiceResult<{ id: string; name: string; description: string | null; isSystem: boolean }>
  > {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data: existing, error: fetchError } = await supabase
      .from('org_roles')
      .select('is_system')
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (fetchError) return toDbFailure(fetchError);

    if (data.name !== undefined && existing.is_system) {
      return failure('FORBIDDEN');
    }

    const update: Record<string, string | null> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.display_name !== undefined) update.display_name = data.display_name;
    if (data.description !== undefined) update.description = data.description;

    if (Object.keys(update).length === 0) {
      return failure('BAD_REQUEST');
    }

    const { data: role, error } = await supabase
      .from('org_roles')
      .update(update)
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .select('id, name, display_name, description, is_system')
      .single();

    if (error) return toDbFailure(error);

    return success({
      id: role.id,
      name: role.name,
      displayName: role.display_name,
      description: role.description,
      isSystem: role.is_system,
    });
  }

  async deleteRole(ctx: RequestContext, id: string): Promise<ServiceResult<void>> {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data: role, error: fetchError } = await supabase
      .from('org_roles')
      .select('is_system')
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (fetchError) return toDbFailure(fetchError);

    if (role.is_system) {
      return failure('FORBIDDEN');
    }

    const { count } = await supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_role_id', id)
      .eq('organization_id', ctx.activeOrgId);

    if (count && count > 0) {
      return failure('CONFLICT');
    }

    const { error } = await supabase
      .from('org_roles')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId);

    if (error) return toDbFailure(error);

    return success(undefined);
  }

  async setPermissions(
    ctx: RequestContext,
    id: string,
    data: SetRolePermissionsInput,
  ): Promise<ServiceResult<void>> {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { error: deleteError } = await supabase
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', id);

    if (deleteError) return toDbFailure(deleteError);

    if (data.permissions.length > 0) {
      const rows = data.permissions.map((p) => ({
        org_role_id: id,
        permission_name: p.permissionName,
        scope: p.scope,
      }));

      const { error: insertError } = await supabase.from('org_role_permissions').insert(rows);

      if (insertError) return toDbFailure(insertError);
    }

    return success(undefined);
  }
}
export const orgRoleService = wrapService(new OrgRoleService(createClient), 'org-role.service');
