import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';
import type { CreateGroupInput, SetGroupMembersInput, UpdateGroupInput } from '@/server/models';
import { planResolver } from '@/server/services';

export class GroupService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async listGroups(ctx: RequestContext): Promise<
    ServiceResult<
      {
        id: string;
        name: string;
        description: string | null;
        created_at: string;
        memberCount: number;
        teacherCount: number;
      }[]
    >
  > {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
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

    if (error) return toDbFailure(error);

    return success(
      data.map((g) => {
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
      }),
    );
  }

  async createGroup(
    ctx: RequestContext,
    data: CreateGroupInput,
  ): Promise<
    ServiceResult<{ id: string; name: string; description: string | null; created_at: string }>
  > {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { count: groupCount } = await supabase
      .from('groups')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', ctx.activeOrgId);
    await planResolver.checkLimit(ctx, 'max_groups', groupCount ?? 0);

    const { data: group, error } = await supabase
      .from('groups')
      .insert({ organization_id: ctx.activeOrgId, ...data })
      .select('id, name, description, created_at')
      .single();

    if (error) return toDbFailure(error);

    return success(group);
  }

  async updateGroup(
    ctx: RequestContext,
    id: string,
    data: UpdateGroupInput,
  ): Promise<
    ServiceResult<{ id: string; name: string; description: string | null; created_at: string }>
  > {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data: group, error } = await supabase
      .from('groups')
      .update(data)
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId)
      .select('id, name, description, created_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') return failure('NOT_FOUND');
      return toDbFailure(error);
    }

    return success(group);
  }

  async deleteGroup(ctx: RequestContext, id: string): Promise<ServiceResult<void>> {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { error } = await supabase
      .from('groups')
      .delete()
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId);

    if (error) return toDbFailure(error);

    return success(undefined);
  }

  async getGroupMembers(
    ctx: RequestContext,
    groupId: string,
  ): Promise<ServiceResult<{ userId: string; role: string }[]>> {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data: group } = await supabase
      .from('groups')
      .select('id')
      .eq('id', groupId)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (!group) return failure('NOT_FOUND');

    const { data, error } = await supabase
      .from('group_members')
      .select('user_id, role')
      .eq('group_id', groupId);

    if (error) return toDbFailure(error);

    return success(data.map((m) => ({ userId: m.user_id, role: m.role })));
  }

  async setGroupMembers(
    ctx: RequestContext,
    groupId: string,
    data: SetGroupMembersInput,
  ): Promise<ServiceResult<void>> {
    const supabase = await this.createClient();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const { data: group } = await supabase
      .from('groups')
      .select('id')
      .eq('id', groupId)
      .eq('organization_id', ctx.activeOrgId)
      .single();

    if (!group) return failure('NOT_FOUND');

    const { error: deleteError } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId);

    if (deleteError) return toDbFailure(deleteError);

    if (data.members.length > 0) {
      const rows = data.members.map((m) => ({
        group_id: groupId,
        user_id: m.userId,
        role: m.role,
      }));

      const { error: insertError } = await supabase.from('group_members').insert(rows);

      if (insertError) return toDbFailure(insertError);
    }

    return success(undefined);
  }

  async getUserGroupIds(ctx: RequestContext): Promise<ServiceResult<string[]>> {
    const supabase = await this.createClient();
    const { data, error } = await supabase.rpc('get_user_group_ids', {
      p_user_id: ctx.userId,
      p_org_id: ctx.activeOrgId,
    });
    if (error) return toDbFailure(error);
    return success((data as { group_id: string }[] | null)?.map((r) => r.group_id) ?? []);
  }

  async isTeacherInGroup(ctx: RequestContext, groupId: string): Promise<ServiceResult<boolean>> {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', ctx.userId)
      .eq('role', 'teacher')
      .maybeSingle();
    if (error) return toDbFailure(error);
    return success(!!data);
  }

  async isUserInGroup(ctx: RequestContext, groupId: string): Promise<ServiceResult<boolean>> {
    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    if (error) return toDbFailure(error);
    return success(!!data);
  }

  async listMyGroups(
    ctx: RequestContext,
  ): Promise<
    ServiceResult<
      { id: string; name: string; organizationId: string; role: string; joinedAt: string }[]
    >
  > {
    const supabase = await this.createClient();

    const { data, error } = await supabase
      .from('group_members')
      .select('role, joined_at, groups!inner(id, name, organization_id)')
      .eq('user_id', ctx.userId);

    if (error) return toDbFailure(error);

    return success(
      data.map((m) => {
        const group = m.groups as unknown as { id: string; name: string; organization_id: string };
        return {
          id: group.id,
          name: group.name,
          organizationId: group.organization_id,
          role: m.role,
          joinedAt: m.joined_at,
        };
      }),
    );
  }
}
