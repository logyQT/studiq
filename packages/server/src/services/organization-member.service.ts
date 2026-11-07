import { AccountType, type RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/** One `org_members` row as `listMembers` selects it (with its joins). */
interface MemberRow {
  user_id: string;
  org_role_id: string;
  org_roles: { name: string; display_name: string | null };
  profiles: { email: string; full_name: string | null; created_at: string | null };
}

type GroupMembership = { id: string; name: string; role: string };

/**
 * One response shape for both `listMembers` branches (educator/group-scoped and
 * organization-wide), so their fields cannot drift.
 */
function toMemberRows(
  rows: MemberRow[],
  organizationId: string,
  groupsByUserId: Record<string, GroupMembership[]>,
) {
  return rows.map((row) => {
    const profile = row.profiles;
    const orgRole = row.org_roles;
    const roleName = orgRole.name;
    return {
      id: row.user_id,
      email: profile.email,
      full_name: profile.full_name,
      orgRoleName: roleName,
      orgRoleDisplayName: orgRole.display_name ?? roleName,
      orgRoleId: row.org_role_id,
      organization_id: organizationId,
      created_at: profile.created_at,
      groups: groupsByUserId[row.user_id] ?? [],
    };
  });
}

export class OrganizationMemberService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async getProfile(ctx: RequestContext) {
    const supabase = await this.clientFactory();

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
    const supabase = await this.clientFactory();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    if (ctx.accountType === AccountType.EDUCATOR && ctx.activeOrgId) {
      const { groupService } = await import('@studiq/server/services/group.service');
      const groupResult = await groupService.getUserGroupIds(ctx);
      if (!groupResult.success) return failure(groupResult.error);
      const groupIds = groupResult.data;
      if (groupIds.length === 0) return success([]);

      const groupSupabase = await this.clientFactory();
      const { data: gmData } = await groupSupabase
        .from('group_members')
        .select('user_id')
        .in('group_id', groupIds);
      const userIds = [...new Set((gmData ?? []).map((gm) => gm.user_id))];
      if (userIds.length === 0) return success([]);

      let query = groupSupabase
        .from('org_members')
        .select(
          'user_id, org_role_id, org_roles!inner(name, display_name), profiles!inner(id, email, full_name, created_at)',
        )
        .in('user_id', userIds)
        .eq('organization_id', ctx.activeOrgId);

      if (roleFilter) {
        query = query.eq('org_roles.name', roleFilter);
      }

      const { data, error } = await query.order('joined_at', { ascending: false });
      if (error) return toDbFailure(error);

      const allUserIds = data.map((m) => m.user_id);
      const { data: groupData, error: groupError } = await groupSupabase
        .from('group_members')
        .select('user_id, role, groups!inner(id, name)')
        .in('user_id', allUserIds)
        .eq('groups.organization_id', ctx.activeOrgId);
      if (groupError) return toDbFailure(groupError);

      const groupsByUserId: Record<string, { id: string; name: string; role: string }[]> = {};
      for (const gm of groupData ?? []) {
        const group = gm.groups;
        if (!groupsByUserId[gm.user_id]) groupsByUserId[gm.user_id] = [];
        groupsByUserId[gm.user_id].push({ id: group.id, name: group.name, role: gm.role });
      }

      return success(toMemberRows(data, ctx.activeOrgId, groupsByUserId));
    }

    let query = supabase
      .from('org_members')
      .select(
        'user_id, org_role_id, org_roles!inner(name, display_name), profiles!inner(id, email, full_name, created_at)',
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
      .in('user_id', userIds)
      .eq('groups.organization_id', ctx.activeOrgId);

    if (groupError) return toDbFailure(groupError);

    const groupsByUserId: Record<string, { id: string; name: string; role: string }[]> = {};
    for (const gm of groupData ?? []) {
      const group = gm.groups;
      if (!groupsByUserId[gm.user_id]) groupsByUserId[gm.user_id] = [];
      groupsByUserId[gm.user_id].push({ id: group.id, name: group.name, role: gm.role });
    }

    return success(toMemberRows(data, ctx.activeOrgId, groupsByUserId));
  }

  async changeRole(ctx: RequestContext, targetUserId: string, newOrgRoleId: string) {
    const supabase = await this.clientFactory();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    if (targetUserId === ctx.userId) {
      return failure('FORBIDDEN');
    }

    // The RLS manager predicate + validate_org_member_org_role trigger are the
    // authoritative gates; this lookup turns a cross-org role id into a clean
    // 403 instead of a database error and avoids a pointless update.
    const { data: role, error: roleError } = await supabase
      .from('org_roles')
      .select('id, organization_id')
      .eq('id', newOrgRoleId)
      .eq('organization_id', ctx.activeOrgId)
      .maybeSingle();
    if (roleError) return toDbFailure(roleError);
    if (!role) return failure('FORBIDDEN');

    const { data: updated, error } = await supabase
      .from('org_members')
      .update({ org_role_id: newOrgRoleId })
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', targetUserId)
      .select('user_id');

    if (error) return toDbFailure(error);
    if (!updated || updated.length === 0) return failure('NOT_FOUND');

    return success({ success: true });
  }

  async removeMember(ctx: RequestContext, targetUserId: string) {
    const supabase = await this.clientFactory();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    if (targetUserId === ctx.userId) {
      return failure('FORBIDDEN');
    }

    // group_members rows for this org are removed by the
    // cleanup_group_members_on_org_member_delete trigger (no FK exists — see
    // #249). Do not add a duplicate DELETE here: it would be filtered by the
    // group.manage RLS policy while removal is gated on member.manage.
    const { data: removed, error } = await supabase
      .from('org_members')
      .delete()
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', targetUserId)
      .select('user_id');

    if (error) return toDbFailure(error);

    // Same contract as changeRole: a foreign/unknown target is NOT_FOUND, never
    // a silent no-op 200 (#189). The row is already scoped to the verified
    // active org, so this cannot distinguish "exists elsewhere" from "does not
    // exist". Returning here also keeps seats untouched for a no-op.
    if (!removed || removed.length === 0) return failure('NOT_FOUND');

    // A removed member keeps no license. Without this the assignment survives
    // (there is no FK cascade), the pool's `assigned` counter stays consumed,
    // and the RLS-narrowed `profiles` read hides the orphan from /manage/seats.
    // The manager-only DELETE policy on org_seat_assignments is the
    // authoritative gate and `maintain_seat_counts` returns the seat to the
    // pool. Member first, seat second: a failure here leaves a visible orphan
    // the manager can still unassign, not a member without a license.
    const { error: seatError } = await supabase
      .from('org_seat_assignments')
      .delete()
      .eq('organization_id', ctx.activeOrgId)
      .eq('user_id', targetUserId);

    if (seatError) return toDbFailure(seatError);

    return success({ success: true });
  }
}
export const organizationMemberService = wrapService(
  new OrganizationMemberService(createClient),
  'organization-member.service',
);
