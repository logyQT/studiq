import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@/lib/request-context';
import { failure, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';

export class OrganizationMemberService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async getProfile(ctx: RequestContext) {
    const supabase = await this.createClient();

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, created_at')
      .eq('id', ctx.userId)
      .single();

    if (error || !profile) {
      return failure('NOT_FOUND');
    }

    return success(profile);
  }

  async listMembers(ctx: RequestContext, roleFilter?: string) {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    if (ctx.accountType === 'educator' && ctx.activeOrgId) {
      const { groupService } = await import('@/server/services');
      const groupResult = await groupService.getUserGroupIds(ctx);
      if (!groupResult.success) return failure(groupResult.error);
      const groupIds = groupResult.data;
      if (groupIds.length === 0) return success([]);

      const supabase = await this.createClient();
      const { data: gmData } = await supabase
        .from('group_members')
        .select('user_id')
        .in('group_id', groupIds);
      const userIds = [...new Set((gmData ?? []).map((gm) => gm.user_id))];
      if (userIds.length === 0) return success([]);

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
      if (error) return toDbFailure(error);

      const allUserIds = data.map((m) => m.user_id);
      const { data: groupData, error: groupError } = await supabase
        .from('group_members')
        .select('user_id, role, groups!inner(id, name)')
        .in('user_id', allUserIds);
      if (groupError) return toDbFailure(groupError);

      const groupsByUserId: Record<string, { id: string; name: string; role: string }[]> = {};
      for (const gm of groupData ?? []) {
        const group = gm.groups as unknown as { id: string; name: string };
        if (!groupsByUserId[gm.user_id]) groupsByUserId[gm.user_id] = [];
        groupsByUserId[gm.user_id].push({ id: group.id, name: group.name, role: gm.role });
      }

      return success(
        data.map((m) => {
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
        }),
      );
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

    if (error) return toDbFailure(error);

    const userIds = data.map((m) => m.user_id);

    const { data: groupData, error: groupError } = await supabase
      .from('group_members')
      .select('user_id, role, groups!inner(id, name)')
      .in('user_id', userIds);

    if (groupError) return toDbFailure(groupError);

    const groupsByUserId: Record<string, { id: string; name: string; role: string }[]> = {};
    for (const gm of groupData ?? []) {
      const group = gm.groups as unknown as { id: string; name: string };
      if (!groupsByUserId[gm.user_id]) groupsByUserId[gm.user_id] = [];
      groupsByUserId[gm.user_id].push({ id: group.id, name: group.name, role: gm.role });
    }

    return success(
      data.map((m) => {
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
      }),
    );
  }

  async changeRole(ctx: RequestContext, targetUserId: string, newOrgRoleId: string) {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    if (targetUserId === ctx.userId) {
      return failure('FORBIDDEN');
    }

    const { error } = await supabase
      .from('org_members')
      .update({ org_role_id: newOrgRoleId })
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', targetUserId);

    if (error) return toDbFailure(error);

    return success({ success: true });
  }

  async removeMember(ctx: RequestContext, targetUserId: string) {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    if (targetUserId === ctx.userId) {
      return failure('FORBIDDEN');
    }

    const { error } = await supabase
      .from('org_members')
      .delete()
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', targetUserId);

    if (error) return toDbFailure(error);

    return success({ success: true });
  }
}
