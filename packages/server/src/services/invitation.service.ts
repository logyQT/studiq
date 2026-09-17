import { AccountType, type RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { CreateInviteInput } from '@studiq/server/models/invitation.model';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';

export class InvitationService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async createInvitation(
    ctx: RequestContext,
    data: CreateInviteInput,
  ): Promise<ServiceResult<{ success: boolean; inviteLink: string | undefined }>> {
    const supabase = await this.createClient();

    let targetOrganizationId: string | undefined;

    if (ctx.accountType === AccountType.MANAGER) {
      targetOrganizationId = data.organizationId ?? ctx.activeOrgId ?? undefined;
      if (!targetOrganizationId) return failure('NOT_FOUND');
    } else if (ctx.accountType === AccountType.EDUCATOR) {
      targetOrganizationId = ctx.activeOrgId ?? undefined;
    }

    if (!targetOrganizationId) {
      return failure('FORBIDDEN');
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const { data: invitation, error: insertError } = await supabase
      .from('invitations')
      .insert({
        email: data.email,
        target_org_role_id: data.targetOrgRoleId,
        organization_id: targetOrganizationId,
        inviter_id: ctx.userId,
        expires_at: expiresAt.toISOString(),
      })
      .select('token')
      .single();

    if (insertError) return toDbFailure(insertError);

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!baseUrl) {
      return failure('INTERNAL_SERVER');
    }
    const inviteLink = `${baseUrl}/join?token=${invitation.token}`;

    return success({
      success: true,
      inviteLink: process.env.NODE_ENV === 'development' ? inviteLink : undefined,
    });
  }

  async getInvitationByToken(token: string): Promise<
    ServiceResult<{
      email: string;
      organizationId: string;
      organizationName: string;
      targetRole: string;
      orgRoleName: string;
    }>
  > {
    const supabase = await this.createClient();

    const { data, error } = await supabase
      .from('invitations')
      .select(
        'email, expires_at, organization_id, target_org_role_id, organizations!inner(name), org_roles!inner(name)',
      )
      .eq('token', token)
      .single();

    if (error || !data) {
      return failure('NOT_FOUND');
    }

    if (new Date(data.expires_at) < new Date()) {
      return failure('GONE');
    }

    const org = data.organizations as unknown as { name: string };
    const role = data.org_roles as unknown as { name: string };

    return success({
      email: data.email,
      organizationId: data.organization_id,
      organizationName: org?.name ?? '',
      targetRole: data.target_org_role_id,
      orgRoleName: role?.name ?? '',
    });
  }

  async acceptInvitation(
    ctx: RequestContext,
    token: string,
  ): Promise<ServiceResult<{ id: string; name: string; orgRoleId: string }>> {
    const supabase = await this.createClient();

    const inviteResult = await this.getInvitationByToken(token);
    if (!inviteResult.success) return inviteResult;
    const invite = inviteResult.data;

    const { count: memberCount } = await supabase
      .from('org_members')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', invite.organizationId);
    await limitsResolver.checkOrgLimit(invite.organizationId, 'max_students', memberCount ?? 0);

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('id', invite.organizationId)
      .single();

    if (orgError || !org) return failure('GONE');

    const { error: memberError } = await supabase
      .from('org_members')
      .upsert({
        organization_id: invite.organizationId,
        user_id: ctx.userId,
        org_role_id: invite.targetRole,
      })
      .select()
      .single();

    if (memberError) return toDbFailure(memberError);

    const { data: defaultGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('organization_id', invite.organizationId)
      .eq('is_default', true)
      .single();

    if (defaultGroup) {
      const { error: me } = await supabase.from('group_members').insert({
        group_id: defaultGroup.id,
        user_id: ctx.userId,
        role: 'member',
      });
      if (me) return toDbFailure(me);
    }

    await supabase.from('invitations').update({ is_accepted: true }).eq('token', token);

    return success({ id: org.id, name: org.name, orgRoleId: invite.targetRole });
  }

  async listInvitations(
    ctx: RequestContext,
    isAccepted = false,
  ): Promise<
    ServiceResult<
      Array<{
        id: string;
        email: string;
        targetOrgRoleId: string;
        orgRoleName: string;
        isAccepted: boolean;
        expiresAt: string;
        createdAt: string;
      }>
    >
  > {
    const supabase = await this.createClient();
    if (!ctx.activeOrgId) return failure('FORBIDDEN');

    let query = supabase
      .from('invitations')
      .select('*, org_roles!inner(name)')
      .eq('organization_id', ctx.activeOrgId)
      .order('created_at', { ascending: false });

    if (!isAccepted) query = query.eq('is_accepted', false);

    const { data, error } = await query;
    if (error) return toDbFailure(error);

    return success(
      (data ?? []).map((inv) => {
        const role = inv.org_roles as unknown as { name: string } | null;
        return {
          id: inv.id,
          email: inv.email,
          targetOrgRoleId: inv.target_org_role_id,
          orgRoleName: role?.name ?? '',
          isAccepted: inv.is_accepted,
          expiresAt: inv.expires_at,
          createdAt: inv.created_at,
        };
      }),
    );
  }

  async updateInvitation(
    _ctx: RequestContext,
    id: string,
    data: { targetOrgRoleId?: string },
  ): Promise<ServiceResult<void>> {
    const supabase = await this.createClient();

    const { data: invite, error: fetchError } = await supabase
      .from('invitations')
      .select('id, is_accepted')
      .eq('id', id)
      .single();

    if (fetchError || !invite) return failure('NOT_FOUND');
    if (invite.is_accepted) return failure('FORBIDDEN');

    const updateData: Record<string, string> = {};
    if (data.targetOrgRoleId) updateData.target_org_role_id = data.targetOrgRoleId;

    const { error } = await supabase.from('invitations').update(updateData).eq('id', id);
    if (error) return toDbFailure(error);

    return success(undefined);
  }

  async deleteInvitation(_ctx: RequestContext, id: string): Promise<ServiceResult<void>> {
    const supabase = await this.createClient();

    const { data: invite, error: fetchError } = await supabase
      .from('invitations')
      .select('id, is_accepted')
      .eq('id', id)
      .single();

    if (fetchError || !invite) return failure('NOT_FOUND');
    if (invite.is_accepted) return failure('FORBIDDEN');

    const { error } = await supabase.from('invitations').delete().eq('id', id);
    if (error) return toDbFailure(error);

    return success(undefined);
  }
}
export const invitationService = wrapService(
  new InvitationService(createClient),
  'invitation.service',
);
