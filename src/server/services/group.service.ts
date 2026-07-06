import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { CreateGroupInput, SetGroupMembersInput, UpdateGroupInput } from '@/server/models';

export class GroupService {
  async listGroups(ctx: RequestContext) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { data, error } = await supabase
      .from('groups')
      .select(
        `
        id, name, description, created_at,
        group_members(count),
        group_members_teachers:group_members!inner(count)
      `,
      )
      .eq('organization_id', ctx.activeOrgId)
      .order('created_at', { ascending: true });

    if (error) throw mapSupabaseError(error);

    return data.map((g) => {
      const total = (g.group_members as unknown as { count: number }[])?.[0]?.count ?? 0;
      const teachers =
        (g.group_members_teachers as unknown as { count: number }[])?.[0]?.count ?? 0;
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        created_at: g.created_at,
        memberCount: total,
        teacherCount: teachers,
      };
    });
  }

  async createGroup(ctx: RequestContext, data: CreateGroupInput) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { data: group, error } = await supabase
      .from('groups')
      .insert({ organization_id: ctx.activeOrgId, ...data })
      .select('id, name, description, created_at')
      .single();

    if (error) throw mapSupabaseError(error);

    return group;
  }

  async updateGroup(ctx: RequestContext, id: string, data: UpdateGroupInput) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { data: group, error } = await supabase
      .from('groups')
      .update(data)
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .select('id, name, description, created_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') throw new AppError('NOT_FOUND');
      throw mapSupabaseError(error);
    }

    return group;
  }

  async deleteGroup(ctx: RequestContext, id: string) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { error } = await supabase
      .from('groups')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId);

    if (error) throw mapSupabaseError(error);

    return { success: true };
  }

  async getGroupMembers(ctx: RequestContext, groupId: string) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { data: group } = await supabase
      .from('groups')
      .select('id')
      .eq('id', groupId)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (!group) throw new AppError('NOT_FOUND');

    const { data, error } = await supabase
      .from('group_members')
      .select('user_id, role')
      .eq('group_id', groupId);

    if (error) throw mapSupabaseError(error);

    return data.map((m) => ({ userId: m.user_id, role: m.role }));
  }

  async setGroupMembers(ctx: RequestContext, groupId: string, data: SetGroupMembersInput) {
    const supabase = await createClient();

    if (!ctx.activeOrgId) {
      throw new AppError('FORBIDDEN');
    }

    const { data: group } = await supabase
      .from('groups')
      .select('id')
      .eq('id', groupId)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (!group) throw new AppError('NOT_FOUND');

    const { error: deleteError } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId);

    if (deleteError) throw mapSupabaseError(deleteError);

    if (data.members.length > 0) {
      const rows = data.members.map((m) => ({
        group_id: groupId,
        user_id: m.userId,
        role: m.role,
      }));

      const { error: insertError } = await supabase.from('group_members').insert(rows);

      if (insertError) throw mapSupabaseError(insertError);
    }

    return { success: true };
  }

  async getUserGroupIds(ctx: RequestContext): Promise<string[]> {
    const supabase = await createClient();
    const { data } = await supabase.rpc('get_user_group_ids', {
      p_user_id: ctx.userId,
      p_org_id: ctx.activeOrgId,
    });
    return (data as { group_id: string }[] | null)?.map((r) => r.group_id) ?? [];
  }

  async isTeacherInGroup(ctx: RequestContext, groupId: string): Promise<boolean> {
    const supabase = await createClient();
    const { data } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', ctx.userId)
      .eq('role', 'teacher')
      .maybeSingle();
    return !!data;
  }

  async isUserInGroup(ctx: RequestContext, groupId: string): Promise<boolean> {
    const supabase = await createClient();
    const { data } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    return !!data;
  }

  async listMyGroups(ctx: RequestContext) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('group_members')
      .select('role, joined_at, groups!inner(id, name, organization_id)')
      .eq('user_id', ctx.userId);

    if (error) throw mapSupabaseError(error);

    return data.map((m) => {
      const group = m.groups as unknown as { id: string; name: string; organization_id: string };
      return {
        id: group.id,
        name: group.name,
        organizationId: group.organization_id,
        role: m.role,
        joinedAt: m.joined_at,
      };
    });
  }
}

export const groupService = new GroupService();
