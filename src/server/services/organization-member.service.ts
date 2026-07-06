import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';

export class OrganizationMemberService {
  async getProfile(ctx: RequestContext) {
    const supabase = await createClient();

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, created_at')
      .eq('id', ctx.userId)
      .single();

    if (error || !profile) {
      throw new AppError('NOT_FOUND');
    }

    return profile;
  }

  async listMembers(ctx: RequestContext, roleFilter?: string) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    // For educators with group scope, filter members to their groups
    if (ctx.accountType === 'educator' && ctx.activeOrgId) {
      const { groupService } = await import('@/server/services/group.service');
      const groupIds = await groupService.getUserGroupIds(ctx);
      if (groupIds.length === 0) return [];

      const supabase = await createClient();
      const { data: gmData } = await supabase
        .from('group_members')
        .select('user_id')
        .in('group_id', groupIds);
      const userIds = [...new Set((gmData ?? []).map((gm) => gm.user_id))];
      if (userIds.length === 0) return [];

      let query = supabase
        .from('org_members')
        .select(
          'user_id, org_role_id, org_roles!inner(name), profiles!inner(id, email, full_name, created_at)',
        )
        .in('user_id', userIds)
        .eq('organization_id', ctx.activeOrgId);

      if (roleFilter) {
        query = query.eq('org_roles.name', roleFilter);
      }

      const { data, error } = await query.order('joined_at', { ascending: false });
      if (error) throw mapSupabaseError(error);

      // Merge group memberships (same as existing flow)
      const allUserIds = data.map((m) => m.user_id);
      const { data: groupData, error: groupError } = await supabase
        .from('group_members')
        .select('user_id, role, groups!inner(id, name)')
        .in('user_id', allUserIds);
      if (groupError) throw mapSupabaseError(groupError);

      const groupsByUserId: Record<string, { id: string; name: string; role: string }[]> = {};
      for (const gm of groupData ?? []) {
        const group = gm.groups as unknown as { id: string; name: string };
        if (!groupsByUserId[gm.user_id]) groupsByUserId[gm.user_id] = [];
        groupsByUserId[gm.user_id].push({ id: group.id, name: group.name, role: gm.role });
      }

      return data.map((m) => {
        const profile = m.profiles as unknown as {
          id: string;
          email: string;
          full_name: string | null;
          created_at: string;
        };
        const roleName = (m.org_roles as unknown as { name: string }).name;
        return {
          id: m.user_id,
          email: profile.email,
          full_name: profile.full_name,
          orgRoleName: roleName,
          orgRoleId: m.org_role_id,
          organization_id: ctx.activeOrgId,
          created_at: profile.created_at,
          groups: groupsByUserId[m.user_id] ?? [],
        };
      });
    }

    let query = supabase
      .from('org_members')
      .select(
        'user_id, org_role_id, org_roles!inner(name), profiles!inner(id, email, full_name, created_at)',
      )
      .eq('organization_id', ctx.activeOrgId);

    if (roleFilter) {
      query = query.eq('org_roles.name', roleFilter);
    }

    const { data, error } = await query.order('joined_at', { ascending: false });

    if (error) throw mapSupabaseError(error);

    const userIds = data.map((m) => m.user_id);

    const { data: groupData, error: groupError } = await supabase
      .from('group_members')
      .select('user_id, role, groups!inner(id, name)')
      .in('user_id', userIds);

    if (groupError) throw mapSupabaseError(groupError);

    const groupsByUserId: Record<string, { id: string; name: string; role: string }[]> = {};
    for (const gm of groupData ?? []) {
      const group = gm.groups as unknown as { id: string; name: string };
      if (!groupsByUserId[gm.user_id]) groupsByUserId[gm.user_id] = [];
      groupsByUserId[gm.user_id].push({ id: group.id, name: group.name, role: gm.role });
    }

    return data.map((m) => {
      const profile = m.profiles as unknown as {
        id: string;
        email: string;
        full_name: string | null;
        created_at: string;
      };
      const roleName = (m.org_roles as unknown as { name: string }).name;
      return {
        id: m.user_id,
        email: profile.email,
        full_name: profile.full_name,
        orgRoleName: roleName,
        orgRoleId: m.org_role_id,
        organization_id: ctx.activeOrgId,
        created_at: profile.created_at,
        groups: groupsByUserId[m.user_id] ?? [],
      };
    });
  }

  async changeRole(ctx: RequestContext, targetUserId: string, newOrgRoleId: string) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    if (targetUserId === ctx.userId) {
      throw new AppError('FORBIDDEN');
    }

    const { error } = await supabase
      .from('org_members')
      .update({ org_role_id: newOrgRoleId })
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', targetUserId);

    if (error) throw mapSupabaseError(error);

    return { success: true };
  }

  async removeMember(ctx: RequestContext, targetUserId: string) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    if (targetUserId === ctx.userId) {
      throw new AppError('FORBIDDEN');
    }

    const { error } = await supabase
      .from('org_members')
      .delete()
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', targetUserId);

    if (error) throw mapSupabaseError(error);

    return { success: true };
  }
}

export const organizationMemberService = new OrganizationMemberService();
