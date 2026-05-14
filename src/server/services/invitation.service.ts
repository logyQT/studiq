import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { CreateInviteInput } from '@/server/models';
import { UserRole } from '@/types';

export class InvitationService {
  async createInvitation(userId: string, data: CreateInviteInput) {
    const supabase = await createClient();

    const { data: inviter } = await supabase
      .from('profiles')
      .select('id, university_id, role')
      .eq('id', userId)
      .single();

    if (!inviter) {
      throw new AppError('NOT_FOUND');
    }

    let targetUniversityId: string | undefined;

    if (inviter.role === UserRole.SYS_ADMIN) {
      if (!data.universityId) throw new AppError('NOT_FOUND');
      targetUniversityId = data.universityId;
    } else if (inviter.role === UserRole.UNIVERSITY_ADMIN) {
      targetUniversityId = inviter.university_id ?? undefined;
    }

    if (!targetUniversityId && inviter.role !== UserRole.SYS_ADMIN) {
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
        university_id: targetUniversityId,
        inviter_id: inviter.id,
        expires_at: expiresAt.toISOString(),
      })
      .select('token')
      .single();

    if (insertError) {
      console.error('Database Error:', insertError);
      throw new AppError('INTERNAL_SERVER');
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!baseUrl) {
      console.warn('NEXT_PUBLIC_SITE_URL is not set. Invitation link will not be generated.');
      throw new AppError('INTERNAL_SERVER');
    }
    const inviteLink = `${baseUrl}/join?token=${invitation.token}`;

    console.warn(`[DEV] Generated invite link for ${data.email}: ${inviteLink}`);

    return {
      success: true,
      inviteLink: process.env.NODE_ENV === 'development' ? inviteLink : undefined,
    };
  }

  async getInvitationByToken(token: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('invitations')
      .select('email, name, expires_at')
      .eq('token', token)
      .single();

    if (error || !data) {
      throw new AppError('NOT_FOUND');
    }

    if (new Date(data.expires_at) < new Date()) {
      throw new AppError('GONE');
    }

    return { email: data.email, name: data.name };
  }
}

export const invitationService = new InvitationService();
