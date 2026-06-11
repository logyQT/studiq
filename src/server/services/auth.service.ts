import { RegisterInput, LoginInput, User } from '@/server/models';
import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { Session } from '@supabase/supabase-js';

export class AuthService {
  async register(data: RegisterInput): Promise<void> {
    const supabase = await createClient();

    if (data.inviteToken) {
      const { data: invite, error: inviteError } = await supabase
        .from('invitations')
        .select('email, name, expires_at')
        .eq('token', data.inviteToken)
        .single();

      if (inviteError || !invite) {
        throw new AppError('BAD_REQUEST');
      }

      if (invite.email !== data.email || invite.name !== data.name) {
        console.error('Invite token does not match email or name:', {
          tokenEmail: invite.email,
          tokenName: invite.name,
          inputEmail: data.email,
          inputName: data.name,
        });
        throw new AppError('UNPROCESSABLE_ENTITY');
      }

      if (new Date(invite.expires_at) < new Date()) {
        throw new AppError('GONE');
      }
    }

    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          name: data.name,
          invite_token: data.inviteToken,
        },
      },
    });

    if (error) {
      if (
        process.env.NODE_ENV === 'development' &&
        (error.status === 422 ||
          error.code === 'user_already_exists' ||
          error.message.includes('already registered'))
      ) {
        return;
      }

      throw new AppError('INTERNAL_SERVER');
    }
  }

  async login(data: LoginInput): Promise<{ user: User; session: Session }> {
    const supabase = await createClient();

    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      throw new AppError('UNAUTHORIZED');
    }

    if (!authData.user || !authData.session) {
      throw new AppError('INTERNAL_SERVER');
    }

    return { user: authData.user, session: authData.session };
  }

  async logout(): Promise<void> {
    const supabase = await createClient();

    const { error } = await supabase.auth.signOut({ scope: 'local' });

    if (error) {
      throw new AppError('INTERNAL_SERVER');
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    const supabase = await createClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email);

    if (error) {
      throw new AppError('BAD_REQUEST');
    }
  }

  async updatePassword(password: string): Promise<void> {
    const supabase = await createClient();

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      if (error.code === 'same_password') {
        throw new AppError('UNPROCESSABLE_ENTITY');
      }

      throw new AppError('BAD_REQUEST');
    }
  }
}

export const authService = new AuthService();
