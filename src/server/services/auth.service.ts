import { RegisterInput, LoginInput, User } from '@/server/models';
import { createClient } from '@/lib/supabase/server';
import { AppError, AppErrorCode } from '@/lib/errors';

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
        throw new AppError(AppErrorCode.INVALID_INPUT, 400); // Invalid token
      }

      // Check if email or name matches
      if (invite.email !== data.email || invite.name !== data.name) {
        console.error('Invite token does not match email or name:', {
          tokenEmail: invite.email,
          tokenName: invite.name,
          inputEmail: data.email,
          inputName: data.name,
        });
        throw new AppError(AppErrorCode.VALIDATION_FAILED, 400);
      }

      // Check expiry
      if (new Date(invite.expires_at) < new Date()) {
        throw new AppError(AppErrorCode.GONE, 410);
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

    // ! Supabase CLI doesn't provide a flag to enable email enumaration protection, so we need to ignore the error in development mode.
    // ! In production Supabase we need to enable email enumaration protection.
    if (error) {
      if (
        process.env.NODE_ENV === 'development' &&
        (error.status === 422 ||
          error.code === 'user_already_exists' ||
          error.message.includes('already registered'))
      ) {
        return;
      }

      console.error('Supabase register error:', error);
      throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    }
  }

  async login(data: LoginInput): Promise<{ user: User }> {
    const supabase = await createClient();

    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      console.error('Supabase login error:', error);
      throw new AppError(AppErrorCode.INVALID_CREDENTIALS, 401);
    }

    if (!authData.user) {
      throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    }

    return { user: authData.user };
  }

  async logout(): Promise<void> {
    const supabase = await createClient();

    const { error } = await supabase.auth.signOut({ scope: 'local' });

    if (error) {
      console.error('Supabase logout error:', error);
      throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    const supabase = await createClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email);

    if (error) {
      console.error('Supabase password reset error:', error);
      throw new AppError(AppErrorCode.PASSWORD_RESET_FAILED, 400);
    }
  }

  async updatePassword(password: string): Promise<void> {
    const supabase = await createClient();

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      console.error('Supabase update password error:', error);

      if (error.code === 'same_password') {
        throw new AppError(AppErrorCode.SAME_PASSWORD, 422);
      }

      throw new AppError(AppErrorCode.PASSWORD_UPDATE_FAILED, 400);
    }
  }
}

export const authService = new AuthService();
