import { AccountType, type RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  CreateGroupInput,
  SetGroupMembersInput,
  UpdateGroupInput,
} from '@studiq/server/models/group.model';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';

function canManageAnyGroup(ctx: RequestContext): boolean {
  return ctx.accountType === AccountType.MANAGER;
}

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
        canManage: boolean;
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
        id, name, description, created_at, created_by,
        group_members(count),
        group_members_teachers:group_members!inner(count)
      `,
      )
      .eq('organization_id', ctx.activeOrgId)
      .eq('group_members_teachers.role', 'teacher')
      .order('created_at', { ascending: true });

    if (error) return toDbFailure(error);

    const manageAny = canManageAnyGroup(ctx);

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
          canManage: manageAny || g.created_by === ctx.userId,
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
    await limitsResolver.checkOrgLimit(ctx.activeOrgId, 'max_groups', groupCount ?? 0);

    const { data: group, error } = await supabase
      .from('groups')
      .insert({ organization_id: ctx.activeOrgId, created_by: ctx.userId, ...data })
      .select('id, name, description, created_at')
      .single();

    if (error) return toDbFailure(error);

    return success(group);
  }

  private async assertCanManage(ctx: RequestContext, id: string): Promise<ServiceResult<void>> {
    if (canManageAnyGroup(ctx)) return success(undefined);

    const supabase = await this.createClient();
    const { data: group } = await supabase
      .from('groups')
      .select('created_by')
      .eq('id', id)
      .eq('organization_id', ctx.activeOrgId as string)
      .maybeSingle();

    if (!group) return failure('NOT_FOUND');
    if (group.created_by !== ctx.userId) return failure('FORBIDDEN');

    return success(undefined);
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

    const authCheck = await this.assertCanManage(ctx, id);
    if (isFailure(authCheck)) return authCheck;

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

    const authCheck = await this.assertCanManage(ctx, id);
    if (isFailure(authCheck)) return authCheck;

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

  /**
   * Org members a group manager can pick from when building the group's
   * roster. Deliberately NOT scoped to the caller's existing groups (unlike
   * organization-member.service.ts's listMembers() for educators) — the
   * assertCanManage check below is the authorization gate, and a teacher
   * building a brand-new group's roster needs to see students they aren't
   * associated with yet.
   */
  async listAddableMembers(
    ctx: RequestContext,
    groupId: string,
  ): Promise<
    ServiceResult<{ id: string; email: string; fullName: string | null; orgRoleName: string }[]>
  > {
    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const authCheck = await this.assertCanManage(ctx, groupId);
    if (isFailure(authCheck)) return authCheck;

    const supabase = await this.createClient();
    const { data, error } = await supabase
      .from('org_members')
      .select('user_id, org_roles!inner(name), profiles!inner(id, email, full_name)')
      .eq('organization_id', ctx.activeOrgId)
      .order('joined_at', { ascending: false });

    if (error) return toDbFailure(error);

    return success(
      data.map((m) => {
        const profile = m.profiles as unknown as {
          id: string;
          email: string;
          full_name: string | null;
        };
        const orgRole = m.org_roles as unknown as { name: string };
        return {
          id: profile.id,
          email: profile.email,
          fullName: profile.full_name,
          orgRoleName: orgRole.name,
        };
      }),
    );
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

    const authCheck = await this.assertCanManage(ctx, groupId);
    if (isFailure(authCheck)) return authCheck;

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
      p_org_id: ctx.activeOrgId ?? null,
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
export const groupService = wrapService(new GroupService(createClient), 'group.service');
