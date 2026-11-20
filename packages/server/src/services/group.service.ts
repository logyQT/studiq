import { type RequestContext } from '@studiq/authz';
import {
  canCreateGroup,
  canGroup,
  resolveGroupScope,
  resolveScope,
} from '@studiq/server/lib/authz';
import { groupInOrg, type GroupInOrgRow } from '@studiq/server/lib/group-in-org';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { dbCount, dbRows } from '@studiq/server/lib/supabase/rows';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  CreateGroupInput,
  SetGroupMembersInput,
  UpdateGroupInput,
} from '@studiq/server/models/group.model';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/** Blank description -> null (clears it); absent key stays absent (no change). */
function normalizeDescription<T extends { description?: string | null }>(data: T): T {
  if (data.description === undefined || data.description === null) return data;
  return { ...data, description: data.description.trim() === '' ? null : data.description.trim() };
}

export class GroupService {
  constructor(
    private clientFactory: () => Promise<SupabaseClient<Database>>,
    // Enrolling the creator (below) runs on the service role, the way org
    // provisioning does: the roster's INSERT policy asks `group.member.manage`
    // for that class, and the creator is not a teacher of it until this very
    // row exists — the same bootstrap the org's default group takes.
    private createEnrolmentClient: () => SupabaseClient<Database> = createServiceClient,
  ) {}

  async listGroups(ctx: RequestContext): Promise<
    ServiceResult<
      {
        id: string;
        name: string;
        description: string | null;
        /** Nullable column (`DEFAULT now()`): a hand-inserted row can lack it. */
        created_at: string | null;
        memberCount: number;
        teacherCount: number;
        /**
         * Which key lets the caller act on this row, as the endpoints resolve
         * it: `group.manage` (the roster plus rename/delete), `group.member.manage`
         * alone (the roster), or `null`. The UI gates each control on this, so a
         * button cannot offer a call the route answers 403 for — the list asks
         * `group.read`, which a caller may hold without either write key.
         */
        manageVia: 'group.manage' | 'group.member.manage' | null;
      }[]
    >
  > {
    const supabase = await this.clientFactory();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    // `group` and `organization` list every class of the org; `own` reaches the
    // ones the caller created (`created_by`, §4.3), which only a row can answer,
    // so it is filtered below. Reading a row is not editing it: `manageVia`
    // still asks `group.manage`. Any other scope reaches nothing.
    const readScope = resolveScope(ctx, 'group.read');
    const readsOrg = readScope === 'group' || readScope === 'organization';
    if (!readsOrg && readScope !== 'own') {
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

    const userId = ctx.userId;
    const visible = readsOrg ? data : data.filter((g) => g.created_by === userId);

    return success(
      visible.map((g) => {
        const total = dbCount(g.group_members);
        const teachers = dbCount(g.group_members_teachers);
        return {
          id: g.id,
          name: g.name,
          description: g.description,
          created_at: g.created_at,
          memberCount: total,
          teacherCount: teachers,
          // ADR-0015 §4.3, §6.3: the same rule `PUT`/`DELETE`/roster enforce, so
          // a button cannot offer a call the route answers 403 for. A roster-only
          // manager (`group.member.manage`, no `group.manage`) gets the members
          // action and not the rename/delete pair.
          manageVia: resolveGroupScope(ctx, 'group.manage', g.id, g)
            ? 'group.manage'
            : resolveGroupScope(ctx, 'group.member.manage', g.id, g)
              ? 'group.member.manage'
              : null,
        };
      }),
    );
  }

  async createGroup(
    ctx: RequestContext,
    data: CreateGroupInput,
  ): Promise<
    ServiceResult<{
      id: string;
      name: string;
      description: string | null;
      created_at: string | null;
    }>
  > {
    const supabase = await this.clientFactory();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    // The controller checks this too; the service repeats it because it is a
    // direct entry point (tests, scripts, seeds). Any scope authorizes it: the
    // creator becomes the class's teacher (ADR-0015 §4.3, §10).
    if (!canCreateGroup(ctx)) return failure('FORBIDDEN');
    const { count: groupCount } = await supabase
      .from('groups')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', ctx.activeOrgId);
    await limitsResolver.checkOrgLimit(ctx.activeOrgId, 'max_groups', groupCount ?? 0);

    const { data: group, error } = await supabase
      .from('groups')
      .insert({
        organization_id: ctx.activeOrgId,
        created_by: ctx.userId,
        ...normalizeDescription(data),
      })
      .select('id, name, description, created_at')
      .single();

    if (error) return toDbFailure(error);

    // A class is the teaching surface (§10), so a create that left the author off
    // its roster would hand back a class nobody can manage: `group.manage` at
    // `group` scope needs a `teacher` row, and no endpoint can write the first
    // one (the roster's INSERT policy asks `group.member.manage` for it). The
    // creator becomes its teacher, which is the claim the create gate makes.
    const enrolmentClient = this.createEnrolmentClient();
    const { error: enrolmentError } = await enrolmentClient
      .from('group_members')
      .insert({ group_id: group.id, user_id: ctx.userId, role: 'teacher' });

    if (enrolmentError) {
      // Never leave an unmanaged class behind: the creator cannot delete it
      // through the caller's client (they are not its teacher), so the same
      // service-role client removes the row the enrolment was for.
      await enrolmentClient.from('groups').delete().eq('id', group.id);
      return toDbFailure(enrolmentError);
    }

    return success(group);
  }

  /**
   * The active-org group `id` names, or the failure that answers the request:
   * NOT_FOUND when the id is not in the active org (tenant existence is never
   * leaked, ADR-0015 §7.1), FORBIDDEN with no active org.
   *
   * `created_by` is selected because `canGroup` reads it: the creator branch is
   * `own`'s whole rule (§4.3), and a lookup that dropped the column would leave
   * `canGroup` unable to answer for a creator whose `group_members` row is not
   * there — the state `setGroupMembers` leaves behind, since it replaces the
   * roster wholesale.
   */
  private async groupInActiveOrg(
    ctx: RequestContext,
    id: string,
  ): Promise<ServiceResult<GroupInOrgRow>> {
    const orgId = ctx.activeOrgId;
    if (!orgId) return failure('FORBIDDEN');
    return groupInOrg(await this.clientFactory(), orgId, id);
  }

  /**
   * Scoped client for a group the caller may modify, per `permission`
   * (`group.manage` for the group itself, `group.member.manage` for its roster).
   * `orgId` is passed back so callers can filter without re-narrowing ctx.
   */
  private async managedGroupScope(
    ctx: RequestContext,
    id: string,
    permission: 'group.manage' | 'group.member.manage',
  ): Promise<ServiceResult<{ supabase: SupabaseClient<Database>; orgId: string }>> {
    const group = await this.groupInActiveOrg(ctx, id);
    if (isFailure(group)) return group;

    if (!canGroup(ctx, permission, group.data)) return failure('FORBIDDEN');

    return success({ supabase: await this.clientFactory(), orgId: group.data.organization_id });
  }

  async updateGroup(
    ctx: RequestContext,
    id: string,
    data: UpdateGroupInput,
  ): Promise<
    ServiceResult<{
      id: string;
      name: string;
      description: string | null;
      created_at: string | null;
    }>
  > {
    const prepared = await this.managedGroupScope(ctx, id, 'group.manage');
    if (isFailure(prepared)) return prepared;
    const { supabase, orgId } = prepared.data;

    const { data: group, error } = await supabase
      .from('groups')
      .update(normalizeDescription(data))
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('id, name, description, created_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') return failure('NOT_FOUND');
      return toDbFailure(error);
    }

    return success(group);
  }

  async deleteGroup(ctx: RequestContext, id: string): Promise<ServiceResult<void>> {
    const prepared = await this.managedGroupScope(ctx, id, 'group.manage');
    if (isFailure(prepared)) return prepared;
    const { supabase, orgId } = prepared.data;

    const { data: deleted, error } = await supabase
      .from('groups')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('id');

    if (error) return toDbFailure(error);

    // The org filter can match zero rows (id from another org); PostgREST
    // reports that as an empty projection, not an error, so project the id to
    // tell "deleted" apart from "not here" (#1124).
    if (dbRows(deleted).length === 0) return failure('NOT_FOUND');

    return success(undefined);
  }

  async getGroupMembers(
    ctx: RequestContext,
    groupId: string,
  ): Promise<ServiceResult<{ userId: string; role: string }[]>> {
    const supabase = await this.clientFactory();

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
   * `group.member.manage` check in `managedGroupScope` is the authorization
   * gate, and a teacher building a brand-new group's roster needs to see
   * students they aren't associated with yet.
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

    const prepared = await this.managedGroupScope(ctx, groupId, 'group.member.manage');
    if (isFailure(prepared)) return prepared;

    const supabase = await this.clientFactory();
    const { data, error } = await supabase
      .from('org_members')
      .select('user_id, org_roles!inner(name), profiles!inner(id, email, full_name)')
      .eq('organization_id', ctx.activeOrgId)
      .order('joined_at', { ascending: false });

    if (error) return toDbFailure(error);

    return success(
      data.map((m) => {
        const profile = m.profiles;
        const orgRole = m.org_roles;
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
    const supabase = await this.clientFactory();

    if (!ctx.activeOrgId) {
      return failure('FORBIDDEN');
    }

    const prepared = await this.managedGroupScope(ctx, groupId, 'group.member.manage');
    if (isFailure(prepared)) return prepared;

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
    const supabase = await this.clientFactory();

    // `p_org_id` is a required (non-nullable) RPC argument: it filters
    // `groups.organization_id = p_org_id`, so without an active org the call
    // provably matches no group and the empty list is the same answer (#148).
    if (!ctx.activeOrgId) return success([]);

    const { data, error } = await supabase.rpc('get_user_group_ids', {
      p_user_id: ctx.userId,
      p_org_id: ctx.activeOrgId,
    });
    if (error) return toDbFailure(error);
    return success(dbRows(data).map((r) => r.group_id));
  }

  async isTeacherInGroup(ctx: RequestContext, groupId: string): Promise<ServiceResult<boolean>> {
    const supabase = await this.clientFactory();
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

  /**
   * Whether the caller may share content to every group in `groupIds`.
   *
   * A group is shareable when it belongs to the CONTENT's organization
   * (`contentOrgId` — the parent row's `organization_id`) and the caller has a
   * `teacher` membership in it. Empty list is trivially allowed.
   *
   * `contentOrgId` is required on purpose: a call site must decide which row the
   * link will hang off. Pass `ctx.activeOrgId` only for content that is being
   * created now, and `existing.organization_id ?? ctx.activeOrgId` for an update
   * of legacy personal content with a NULL org.
   *
   * `ctx.groupIds` is the caller's own membership list in the active org, so it
   * is not a tenant authority: every incoming group id must still be verified
   * against `contentOrgId`, because a group id from another org could otherwise
   * slip past the caller's membership list and reach the query below.
   */
  async canShareContentToGroups(
    ctx: RequestContext,
    groupIds: string[],
    contentOrgId: string | null,
  ): Promise<ServiceResult<boolean>> {
    const unique = [...new Set(groupIds)];
    if (unique.length === 0) return success(true);
    if (!contentOrgId) return success(false);

    const supabase = await this.clientFactory();
    const { data, error } = await supabase
      .from('group_members')
      .select('group_id, groups!inner(organization_id)')
      .eq('user_id', ctx.userId)
      .eq('role', 'teacher')
      .in('group_id', unique)
      .eq('groups.organization_id', contentOrgId);

    if (error) return toDbFailure(error);

    const taught = new Set(dbRows(data).map((row) => row.group_id));
    return success(unique.every((id) => taught.has(id)));
  }

  async isUserInGroup(ctx: RequestContext, groupId: string): Promise<ServiceResult<boolean>> {
    const supabase = await this.clientFactory();
    const { data, error } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    if (error) return toDbFailure(error);
    return success(!!data);
  }

  async listMyGroups(ctx: RequestContext): Promise<
    ServiceResult<
      {
        id: string;
        name: string;
        organizationId: string;
        role: string;
        /** Nullable column (`DEFAULT now()`); a membership can lack it. */
        joinedAt: string | null;
      }[]
    >
  > {
    const supabase = await this.clientFactory();

    // Scope to orgs the caller still belongs to: a group row is org data, and a
    // stale group_members row must not keep it visible after the user was
    // removed from the organization (#249).
    const { data: orgRows, error: orgError } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('user_id', ctx.userId);

    if (orgError) return toDbFailure(orgError);

    const orgIds = dbRows(orgRows).map((r) => r.organization_id);
    if (orgIds.length === 0) return success([]);

    const { data, error } = await supabase
      .from('group_members')
      .select('role, joined_at, groups!inner(id, name, organization_id)')
      .eq('user_id', ctx.userId)
      .in('groups.organization_id', orgIds);

    if (error) return toDbFailure(error);

    return success(
      data.map((m) => {
        const group = m.groups;
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
