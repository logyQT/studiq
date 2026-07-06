import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type {
  CreateOrgRoleInput,
  SetRolePermissionsInput,
  UpdateOrgRoleInput,
} from '@/server/models';

export class OrgRoleService {
  async listRoles(ctx: RequestContext) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { data, error } = await supabase
      .from('org_roles')
      .select(
        `
        id, name, description, is_system,
        org_members:org_members(count),
        org_role_permissions:org_role_permissions(count)
      `,
      )
      .eq('organization_id', ctx.activeOrgId)
      .order('name');

    if (error) throw mapSupabaseError(error);

    return (data ?? []).map((r) => {
      const memberCount = (r.org_members as unknown as { count: number }[])?.[0]?.count ?? 0;
      const permissionCount =
        (r.org_role_permissions as unknown as { count: number }[])?.[0]?.count ?? 0;
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.is_system,
        memberCount,
        permissionCount,
      };
    });
  }

  async getRole(ctx: RequestContext, id: string) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { data, error } = await supabase
      .from('org_roles')
      .select(
        `
        id, name, description, is_system,
        org_role_permissions(permission_name, scope)
      `,
      )
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (error) throw mapSupabaseError(error);

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      isSystem: data.is_system,
      permissions:
        (data.org_role_permissions as unknown as { permission_name: string; scope: string }[])?.map(
          (p) => ({ permissionName: p.permission_name, scope: p.scope }),
        ) ?? [],
    };
  }

  async createRole(ctx: RequestContext, data: CreateOrgRoleInput) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { data: role, error } = await supabase
      .from('org_roles')
      .insert({
        organization_id: ctx.activeOrgId,
        name: data.name,
        description: data.description ?? null,
        is_system: false,
      })
      .select('id, name, description, is_system')
      .single();

    if (error) throw mapSupabaseError(error);

    return role;
  }

  async updateRole(ctx: RequestContext, id: string, data: UpdateOrgRoleInput) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const update: Record<string, string> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;

    if (Object.keys(update).length === 0) {
      throw new AppError('BAD_REQUEST');
    }

    const { data: role, error } = await supabase
      .from('org_roles')
      .update(update)
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .select('id, name, description, is_system')
      .single();

    if (error) throw mapSupabaseError(error);

    return role;
  }

  async deleteRole(ctx: RequestContext, id: string) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { data: role, error: fetchError } = await supabase
      .from('org_roles')
      .select('is_system')
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (fetchError) throw mapSupabaseError(fetchError);

    if (role.is_system) {
      throw new AppError('FORBIDDEN');
    }

    const { count } = await supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_role_id', id)
      .eq('organization_id', ctx.activeOrgId);

    if (count && count > 0) {
      throw new AppError('CONFLICT');
    }

    const { error } = await supabase
      .from('org_roles')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId);

    if (error) throw mapSupabaseError(error);
  }

  async setPermissions(ctx: RequestContext, id: string, data: SetRolePermissionsInput) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { error: deleteError } = await supabase
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', id);

    if (deleteError) throw mapSupabaseError(deleteError);

    if (data.permissions.length > 0) {
      const rows = data.permissions.map((p) => ({
        org_role_id: id,
        permission_name: p.permissionName,
        scope: p.scope,
      }));

      const { error: insertError } = await supabase.from('org_role_permissions').insert(rows);

      if (insertError) throw mapSupabaseError(insertError);
    }
  }
}

export const orgRoleService = new OrgRoleService();
