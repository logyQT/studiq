import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import type { LoginInput, RegisterInput, User } from '@studiq/server/models/auth.model';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

export class AuthService {
  /**
   * How long a session established by verifying an e-mail token (recovery link)
   * may be used to set a password without re-entering the current one.
   */
  private static readonly OTP_SESSION_MAX_AGE_SECONDS = 30 * 60;

  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async register(data: RegisterInput): Promise<ServiceResult<void, 'INTERNAL_SERVER'>> {
    const supabase = await this.createClient();

    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          name: data.name,
          account_type: data.accountType,
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
        return success(undefined);
      }

      return failure('INTERNAL_SERVER');
    }

    return success(undefined);
  }

  async login(
    data: LoginInput,
  ): Promise<ServiceResult<{ user: User; session: Session }, 'UNAUTHORIZED' | 'INTERNAL_SERVER'>> {
    const supabase = await this.createClient();

    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      return failure('UNAUTHORIZED');
    }

    if (!authData.user || !authData.session) {
      return failure('INTERNAL_SERVER');
    }

    return success({ user: authData.user, session: authData.session });
  }

  async logout(): Promise<ServiceResult<void, 'INTERNAL_SERVER'>> {
    const supabase = await this.createClient();

    const { error } = await supabase.auth.signOut({ scope: 'local' });

    if (error) {
      return failure('INTERNAL_SERVER');
    }

    return success(undefined);
  }

  async requestPasswordReset(email: string): Promise<ServiceResult<void, 'BAD_REQUEST'>> {
    const supabase = await this.createClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email);

    if (error) {
      return failure('BAD_REQUEST');
    }

    return success(undefined);
  }

  async updateProfile(data: { name: string }): Promise<ServiceResult<User, 'BAD_REQUEST'>> {
    const supabase = await this.createClient();

    const { data: updatedUser, error } = await supabase.auth.updateUser({
      data: { name: data.name },
    });

    if (error) {
      return failure('BAD_REQUEST');
    }

    return success(updatedUser.user as User);
  }

  async updatePassword(data: {
    currentPassword?: string;
    password: string;
  }): Promise<
    ServiceResult<
      void,
      | 'INVALID_CURRENT_PASSWORD'
      | 'RATE_LIMITED'
      | 'UNAUTHORIZED'
      | 'UNPROCESSABLE_ENTITY'
      | 'BAD_REQUEST'
    >
  > {
    const supabase = await this.createClient();

    if (data.currentPassword !== undefined) {
      // Account flow: prove the caller knows the current password before
      // replacing it. `signInWithPassword` is the only check Supabase exposes
      // for this; it also rotates the session cookies (same as a login).
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.email) {
        return failure('UNAUTHORIZED');
      }

      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: data.currentPassword,
      });

      if (reauthError) {
        if (reauthError.status === 429 || reauthError.code === 'over_request_rate_limit') {
          return failure('RATE_LIMITED');
        }

        return failure('INVALID_CURRENT_PASSWORD');
      }
    } else if (!(await this.isFreshOtpSession(supabase))) {
      // Password-reset flow: only allowed right after the recovery link was
      // verified, so a hijacked session cannot skip the current-password check.
      return failure('BAD_REQUEST');
    }

    const { error } = await supabase.auth.updateUser({ password: data.password });

    if (error) {
      if (error.code === 'same_password') {
        return failure('UNPROCESSABLE_ENTITY');
      }

      return failure('BAD_REQUEST');
    }

    return success(undefined);
  }

  /**
   * True when the current session was established by verifying an e-mail token
   * (recovery link) less than 30 minutes ago. The `amr` claim is signed by
   * Supabase, so a session hijacker cannot forge it; the timestamp bounds how
   * long an old OTP session can be replayed. Fails closed when the claim is
   * missing or carries no timestamp.
   */
  private async isFreshOtpSession(supabase: SupabaseClient): Promise<boolean> {
    const { data, error } = await supabase.auth.getClaims();

    if (error || !data?.claims) {
      return false;
    }

    const amr = data.claims.amr;

    if (!Array.isArray(amr)) {
      return false;
    }

    const now = Date.now() / 1000;

    return amr.some((entry) => {
      if (typeof entry === 'string' || entry?.method !== 'otp') {
        return false;
      }

      return (
        typeof entry.timestamp === 'number' &&
        now - entry.timestamp <= AuthService.OTP_SESSION_MAX_AGE_SECONDS
      );
    });
  }
}
export const authService = wrapService(new AuthService(createClient), 'auth.service');
