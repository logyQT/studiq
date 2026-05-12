import { createClient } from '@/lib/supabase/server';
import { AppError, AppErrorCode } from '@/lib/errors';
import { CreateInviteInput } from '@/server/models';
import { UserRole } from '@/types';

export class InvitationService {
  async createInvitation(data: CreateInviteInput) {
    const supabase = await createClient();

    // 1. Autoryzacja i pobranie profilu zapraszającego
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new AppError(AppErrorCode.UNAUTHORIZED, 401);
    }

    const { data: inviter } = await supabase
      .from('profiles')
      .select('id, university_id, role')
      .eq('id', user.id)
      .single();

    if (!inviter) {
      throw new AppError(AppErrorCode.NOT_FOUND, 404);
    }

    // 2. Logika wyboru uniwersytetu (SSoT)
    let targetUniversityId: string | undefined;

    if (inviter.role === UserRole.SYS_ADMIN) {
      if (!data.universityId) throw new AppError(AppErrorCode.UNIVERSITY_NOT_FOUND, 400);
      targetUniversityId = data.universityId;
    } else if (inviter.role === UserRole.UNIVERSITY_ADMIN) {
      targetUniversityId = inviter.university_id ?? undefined;
    }

    // 3. Weryfikacja: Jeśli nie jesteś Sys Adminem, musisz mieć przypisaną uczelnię
    if (!targetUniversityId && inviter.role !== UserRole.SYS_ADMIN) {
      throw new AppError(AppErrorCode.FORBIDDEN, 403);
    }

    // 4. Ważność zaproszenia: 7 dni
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // 5. Zapis w bazie (Token generuje Postgres automatycznie)
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
      throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!baseUrl) {
      console.warn('NEXT_PUBLIC_SITE_URL is not set. Invitation link will not be generated.');
      throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    }
    const inviteLink = `${baseUrl}/join?token=${invitation.token}`;

    // ! TEMP
    console.warn(`[DEV] Generated invite link for ${data.email}: ${inviteLink}`);

    // await mailService.sendInvitationEmail(data.email, inviteLink, data.role);

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
      throw new AppError(AppErrorCode.NOT_FOUND, 404);
    }

    if (new Date(data.expires_at) < new Date()) {
      throw new AppError(AppErrorCode.GONE, 410); // Token expired
    }

    return { email: data.email, name: data.name };
  }
}

export const invitationService = new InvitationService();
