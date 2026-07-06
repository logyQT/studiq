import { AppError } from '@/lib/errors';
import { log } from '@/lib/logger';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { CreateInviteInput } from '@/server/models';
import { AccountType } from '@/types';

export class InvitationService {
  async createInvitation(ctx: RequestContext, data: CreateInviteInput) {
    const supabase = await createClient();

    let targetOrganizationId: string | undefined;

    if (ctx.accountType === AccountType.MANAGER) {
      targetOrganizationId = data.organizationId ?? ctx.activeOrgId ?? undefined;
      if (!targetOrganizationId) throw new AppError('NOT_FOUND');
    } else if (ctx.accountType === AccountType.EDUCATOR) {
      targetOrganizationId = ctx.activeOrgId ?? undefined;
    }

    if (!targetOrganizationId) {
      throw new AppError('FORBIDDEN');
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

    if (insertError) throw mapSupabaseError(insertError);

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!baseUrl) {
      throw new AppError('INTERNAL_SERVER');
    }
    const inviteLink = `${baseUrl}/join?token=${invitation.token}`;

    log.auth.warn(`[DEV] Generated invite link for ${data.email}: ${inviteLink}`);

    return {
      success: true,
      inviteLink: process.env.NODE_ENV === 'development' ? inviteLink : undefined,
    };
  }

  async getInvitationByToken(token: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('invitations')
      .select(
        'email, expires_at, organization_id, target_org_role_id, organizations!inner(name, slug), org_roles!inner(name)',
      )
      .eq('token', token)
      .single();

    if (error || !data) {
      throw new AppError('NOT_FOUND');
    }

    if (new Date(data.expires_at) < new Date()) {
      throw new AppError('GONE');
    }

    const org = data.organizations as unknown as { name: string; slug: string };
    const role = data.org_roles as unknown as { name: string };

    return {
      email: data.email,
      organizationId: data.organization_id,
      organizationName: org?.name ?? '',
      organizationSlug: org?.slug ?? '',
      targetRole: data.target_org_role_id,
      orgRoleName: role?.name ?? '',
    };
  }

  async acceptInvitation(ctx: RequestContext, token: string) {
    const supabase = await createClient();

    const invite = await this.getInvitationByToken(token);

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, slug')
      .eq('id', invite.organizationId)
      .single();

    if (orgError || !org) throw new AppError('GONE');

    const { error: memberError } = await supabase
      .from('org_members')
      .upsert({
        organization_id: invite.organizationId,
        user_id: ctx.userId,
        org_role_id: invite.targetRole,
      })
      .select()
      .single();

    if (memberError) throw mapSupabaseError(memberError);

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
      if (me) throw mapSupabaseError(me);
    }

    await supabase.from('invitations').update({ is_accepted: true }).eq('token', token);

    return { id: org.id, name: org.name, slug: org.slug, orgRoleId: invite.targetRole };
  }

  async listInvitations(ctx: RequestContext, isAccepted = false) {
    const supabase = await createClient();
    if (!ctx.activeOrgId) throw new AppError('FORBIDDEN');

    let query = supabase
      .from('invitations')
      .select('*, org_roles!inner(name)')
      .eq('organization_id', ctx.activeOrgId)
      .order('created_at', { ascending: false });

    if (!isAccepted) query = query.eq('is_accepted', false);

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);

    return (data ?? []).map((inv) => {
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
    });
  }

  async updateInvitation(_ctx: RequestContext, id: string, data: { targetOrgRoleId?: string }) {
    const supabase = await createClient();

    const { data: invite, error: fetchError } = await supabase
      .from('invitations')
      .select('id, is_accepted')
      .eq('id', id)
      .single();

    if (fetchError || !invite) throw new AppError('NOT_FOUND');
    if (invite.is_accepted) throw new AppError('FORBIDDEN');

    const updateData: Record<string, string> = {};
    if (data.targetOrgRoleId) updateData.target_org_role_id = data.targetOrgRoleId;

    const { error } = await supabase.from('invitations').update(updateData).eq('id', id);
    if (error) throw mapSupabaseError(error);

    return { success: true };
  }

  async deleteInvitation(_ctx: RequestContext, id: string) {
    const supabase = await createClient();

    const { data: invite, error: fetchError } = await supabase
      .from('invitations')
      .select('id, is_accepted')
      .eq('id', id)
      .single();

    if (fetchError || !invite) throw new AppError('NOT_FOUND');
    if (invite.is_accepted) throw new AppError('FORBIDDEN');

    const { error } = await supabase.from('invitations').delete().eq('id', id);
    if (error) throw mapSupabaseError(error);

    return { success: true };
  }
}

export const invitationService = new InvitationService();
