import { AppError } from '@studiq/server/lib/errors';
import { warn } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import type { LoginInput, RegisterInput, User } from '@studiq/server/models/auth.model';
import {
  // Aliased: the constructor parameter below shadows the barrel name, and a
  // self-referencing default would be a TDZ error at module init.
  invitationService as defaultInvitationService,
  type InvitationService,
} from '@studiq/server/services/invitation.service';
import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';

/**
 * GoTrue reports a sign-up for an existing e-mail as `user_already_exists`
 * (422); older gateways only carry the message. Deliberately *not*
 * `status === 422`: weak passwords / disabled sign-ups / invalid addresses are
 * 4xx too and must not be reported to the user as "activation link sent" (#300).
 */
function isExistingEmail(error: AuthError): boolean {
  return (
    error.code === 'user_already_exists' ||
    error.code === 'email_exists' ||
    error.message.toLowerCase().includes('already registered')
  );
}

export class AuthService {
  /**
   * How long a session established by verifying an e-mail token (recovery link)
   * may be used to set a password without re-entering the current one.
   */
  private static readonly OTP_SESSION_MAX_AGE_SECONDS = 30 * 60;

  constructor(
    private createClient: () => Promise<SupabaseClient>,
    private invitationService: InvitationService = defaultInvitationService,
  ) {}

  async register(
    data: RegisterInput,
  ): Promise<ServiceResult<void, 'INTERNAL_SERVER' | 'NOT_FOUND' | 'GONE' | 'BAD_REQUEST'>> {
    // Invite-link registration (/join?token=…): refuse a token that is already
    // dead or was issued to a different address *before* creating an account, so
    // the invitee never ends up as a silent standalone account (ONB-08, #311).
    let inviteToken: string | undefined;

    if (data.inviteToken) {
      const preview = await this.invitationService.getInvitationByToken(data.inviteToken);

      if (isFailure(preview)) {
        return failure(preview.error);
      }

      if (preview.data.email.toLowerCase() !== data.email.toLowerCase()) {
        return failure('BAD_REQUEST');
      }

      inviteToken = data.inviteToken;
    }

    const supabase = await this.createClient();

    const metadata: Record<string, unknown> = {
      name: data.name,
      account_type: data.accountType,
    };
    // Only present on the invite flow, so a plain registration stays identical.
    if (inviteToken) metadata.invite_token = inviteToken;

    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: metadata,
      },
    });

    if (error) {
      // Public endpoint: a duplicate must be indistinguishable from a fresh
      // registration (no account enumeration). GoTrue creates no user and sends
      // no mail here, so the caller still gets the neutral 202 from the
      // controller — in every environment.
      if (isExistingEmail(error)) return success(undefined);

      return failure('INTERNAL_SERVER');
    }

    return success(undefined);
  }

  /**
   * Accept the invitation carried in `user_metadata.invite_token` after the
   * e-mail address has been proven (the activation callback). Best-effort by
   * design: a dead invitation, a demoted inviter or a full organization must
   * never block activation or login — the invitation simply stays pending and
   * can still be accepted later via `/app/join`. Never throws.
   */
  async claimInvitation(
    user: Pick<User, 'id' | 'user_metadata'>,
  ): Promise<{ orgId: string } | null> {
    const token = user.user_metadata?.invite_token;
    if (typeof token !== 'string' || token.trim() === '') return null;

    try {
      // Same authorization as the explicit accept path: the token must be live,
      // unused and internally consistent, and the inviter must still be allowed
      // to grant the target role. Nothing is bypassed here (#311).
      const result = await this.invitationService.acceptInvitationForUser(user.id, token);

      if (isFailure(result)) {
        warn('Invitation not accepted during activation', {
          'user.id': user.id,
          'error.code': result.error,
        });
        return null;
      }

      return { orgId: result.data.id };
    } catch (error) {
      warn('Invitation acceptance failed during activation', {
        'user.id': user.id,
        'error.code': error instanceof AppError ? error.code : 'INTERNAL_SERVER',
      });
      return null;
    }
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
