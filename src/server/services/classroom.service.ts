import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { CreateClassroomInput } from '@/server/models';

export async function seedDefaultOrgRoles(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string> {
  const roles = [
    { name: 'member', description: 'Base learner — read own + group content, create own' },
    { name: 'teacher', description: 'Educator — CRUD over own content' },
    { name: 'admin', description: 'Org manager — settings, members, roles' },
  ];

  const roleIds: Record<string, string> = {};

  for (const role of roles) {
    const { data } = await supabase
      .from('org_roles')
      .insert({
        organization_id: orgId,
        name: role.name,
        description: role.description,
        is_system: true,
      })
      .select('id')
      .single();
    if (!data) throw new Error(`Failed to create role: ${role.name}`);
    roleIds[role.name] = data.id;
  }

  const { data: permissions } = await supabase.from('permissions').select('name');

  if (permissions) {
    for (const perm of permissions) {
      if (perm.name.endsWith('.delete')) {
        await supabase.from('org_role_permissions').insert([
          { org_role_id: roleIds.member, permission_name: perm.name, scope: 'own' },
          { org_role_id: roleIds.teacher, permission_name: perm.name, scope: 'own' },
          { org_role_id: roleIds.admin, permission_name: perm.name, scope: 'organization' },
        ]);
      } else if (perm.name.endsWith('.create') || perm.name.endsWith('.update')) {
        await supabase.from('org_role_permissions').insert([
          { org_role_id: roleIds.member, permission_name: perm.name, scope: 'own' },
          { org_role_id: roleIds.teacher, permission_name: perm.name, scope: 'own' },
          { org_role_id: roleIds.admin, permission_name: perm.name, scope: 'organization' },
        ]);
      } else if (perm.name.endsWith('.read')) {
        await supabase.from('org_role_permissions').insert([
          { org_role_id: roleIds.member, permission_name: perm.name, scope: 'group' },
          { org_role_id: roleIds.teacher, permission_name: perm.name, scope: 'own' },
          { org_role_id: roleIds.admin, permission_name: perm.name, scope: 'organization' },
        ]);
      }
    }
  }

  return roleIds.admin;
}

export class ClassroomService {
  async create(ctx: RequestContext, data: CreateClassroomInput) {
    const supabase = await createClient();

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({ name: data.name })
      .select()
      .single();

    if (orgError) throw mapSupabaseError(orgError);

    const adminRoleId = await seedDefaultOrgRoles(supabase, org.id);

    const { error: memberError } = await supabase.from('org_members').insert({
      organization_id: org.id,
      user_id: ctx.userId,
      org_role_id: adminRoleId,
    });

    if (memberError) {
      await supabase.from('organizations').delete().eq('id', org.id);
      throw mapSupabaseError(memberError);
    }

    return { ...org, adminRoleId };
  }
}

export const classroomService = new ClassroomService();
