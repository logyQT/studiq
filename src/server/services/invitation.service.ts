import { log } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { CreateInviteInput } from '@/server/models';
import { UserRole } from '@/types';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';

export class InvitationService {
  async createInvitation(ctx: RequestContext, data: CreateInviteInput) {
    const supabase = await createClient();

    let targetOrganizationId: string | undefined;

    if (ctx.role === UserRole.SYS_ADMIN) {
      if (!data.organizationId) throw new AppError('NOT_FOUND');
      targetOrganizationId = data.organizationId;
    } else if (ctx.role === UserRole.UNIVERSITY_ADMIN) {
      targetOrganizationId = ctx.activeOrgId ?? undefined;
    } else if (ctx.role === UserRole.TEACHER) {
      targetOrganizationId = ctx.activeOrgId ?? undefined;
      if (data.role !== UserRole.STUDENT) throw new AppError('FORBIDDEN');
    }

    if (!targetOrganizationId && ctx.role !== UserRole.SYS_ADMIN) {
      throw new AppError('FORBIDDEN');
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const { data: invitation, error: insertError } = await supabase
      .from('invitations')
      .insert({
        email: data.email,
        name: data.name,
        target_role: data.role,
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
      .select('email, name, expires_at, organization_id, target_role')
      .eq('token', token)
      .single();

    if (error || !data) {
      throw new AppError('NOT_FOUND');
    }

    if (new Date(data.expires_at) < new Date()) {
      throw new AppError('GONE');
    }

    return { email: data.email, name: data.name, organizationId: data.organization_id, targetRole: data.target_role };
  }

  async acceptInvitation(ctx: RequestContext, token: string) {
    const supabase = await createClient();

    const invite = await this.getInvitationByToken(token);

    if (invite.targetRole !== ctx.role) {
      throw new AppError('FORBIDDEN');
    }

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, slug')
      .eq('id', invite.organizationId)
      .single();

    if (orgError || !org) throw new AppError('GONE');

    const { error: memberError } = await supabase.from('org_members').upsert({
      organization_id: invite.organizationId,
      user_id: ctx.userId,
      role: invite.targetRole,
    }).select().single();

    if (memberError) throw mapSupabaseError(memberError);

    await supabase
      .from('invitations')
      .update({ is_accepted: true })
      .eq('token', token);

    return { id: org.id, name: org.name, slug: org.slug, role: invite.targetRole };
  }
}

export const invitationService = new InvitationService();
