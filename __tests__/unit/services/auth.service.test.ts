import { AppError } from '@studiq/server/lib/errors';
import { failure, success } from '@studiq/server/lib/service-result';
import { AuthService } from '@studiq/server/services/auth.service';
import type { InvitationService } from '@studiq/server/services/invitation.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function stubInvitationService() {
  return {
    getInvitationByToken: vi.fn(),
    acceptInvitationForUser: vi.fn(),
  };
}

describe('AuthService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new AuthService(async () => mock as any);
  });

  describe('register', () => {
    it('calls signUp with correct data', async () => {
      mock.auth.signUp.mockResolvedValueOnce({
        data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
        error: null,
      });

      const result = await service.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(result.success).toBe(true);
      expect(mock.auth.signUp).toHaveBeenCalledWith({
        email: 'john@example.com',
        password: 'SecurePass1',
        options: {
          data: {
            name: 'John Doe',
            account_type: undefined,
          },
        },
      });
    });

    it('returns early in development when user already exists', async () => {
      vi.stubEnv('NODE_ENV', 'development');

      mock.auth.signUp.mockResolvedValueOnce({
        data: {},
        error: { status: 422, code: 'user_already_exists', message: 'User already registered' },
      });

      const result = await service.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(result.success).toBe(true);

      vi.unstubAllEnvs();
    });

    it('throws INTERNAL_SERVER when signUp fails in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');

      mock.auth.signUp.mockResolvedValueOnce({
        data: {},
        error: { message: 'Server error' },
      });

      const result = await service.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');

      vi.unstubAllEnvs();
    });
  });

  // #311 / ONB-08: the invite link must survive registration and be accepted
  // after the e-mail is verified, otherwise the invitee stays standalone.
  describe('register with an invitation token', () => {
    let invites: ReturnType<typeof stubInvitationService>;

    const registration = {
      name: 'John Doe',
      email: 'invitee@example.com',
      password: 'SecurePass1',
      accountType: 'student' as const,
    };

    const preview = {
      email: 'invitee@example.com',
      organizationId: 'org-1',
      organizationName: 'WSB Merito',
      targetRole: 'role-member',
      orgRoleName: 'member',
    };

    beforeEach(() => {
      invites = stubInvitationService();
      service = new AuthService(async () => mock as any, invites as unknown as InvitationService);
    });

    it('leaves a plain registration untouched', async () => {
      mock.auth.signUp.mockResolvedValueOnce({ data: {}, error: null });

      const result = await service.register(registration);

      expect(result.success).toBe(true);
      expect(invites.getInvitationByToken).not.toHaveBeenCalled();
      expect(mock.auth.signUp).toHaveBeenCalledWith({
        email: 'invitee@example.com',
        password: 'SecurePass1',
        options: { data: { name: 'John Doe', account_type: 'student' } },
      });
      expect(mock.auth.signUp.mock.calls[0][0].options.data).not.toHaveProperty('invite_token');
    });

    it('stores a usable token in the sign-up metadata', async () => {
      // E-mail comparison is case-insensitive: the address is stored as typed
      // by the manager, the form may normalize it.
      invites.getInvitationByToken.mockResolvedValueOnce(success(preview));
      mock.auth.signUp.mockResolvedValueOnce({ data: {}, error: null });

      const result = await service.register({ ...registration, inviteToken: 'tok-1' });

      expect(result.success).toBe(true);
      expect(invites.getInvitationByToken).toHaveBeenCalledWith('tok-1');
      expect(mock.auth.signUp).toHaveBeenCalledWith({
        email: 'invitee@example.com',
        password: 'SecurePass1',
        options: {
          data: { name: 'John Doe', account_type: 'student', invite_token: 'tok-1' },
        },
      });
    });

    it('does not create an account when the invitation is gone', async () => {
      invites.getInvitationByToken.mockResolvedValueOnce(failure('GONE'));

      const result = await service.register({ ...registration, inviteToken: 'dead' });

      expect(result).toEqual({ success: false, error: 'GONE' });
      expect(mock.auth.signUp).not.toHaveBeenCalled();
    });

    it('propagates NOT_FOUND for an unknown token', async () => {
      invites.getInvitationByToken.mockResolvedValueOnce(failure('NOT_FOUND'));

      const result = await service.register({ ...registration, inviteToken: 'unknown' });

      expect(result).toEqual({ success: false, error: 'NOT_FOUND' });
      expect(mock.auth.signUp).not.toHaveBeenCalled();
    });

    it('rejects a token issued to a different address without creating an account', async () => {
      invites.getInvitationByToken.mockResolvedValueOnce(
        success({ ...preview, email: 'someone-else@example.com' }),
      );

      const result = await service.register({ ...registration, inviteToken: 'foreign' });

      expect(result).toEqual({ success: false, error: 'BAD_REQUEST' });
      expect(mock.auth.signUp).not.toHaveBeenCalled();
    });
  });

  // #311: the callback calls this after verifyOtp; it must never block
  // activation/login, and it must not bypass the accept authorization.
  describe('claimInvitation', () => {
    let invites: ReturnType<typeof stubInvitationService>;

    const user = { id: 'user-1', user_metadata: { invite_token: 'tok-1' } };
    const membership = { id: 'org-1', name: 'WSB Merito', orgRoleId: 'role-member' };

    beforeEach(() => {
      invites = stubInvitationService();
      service = new AuthService(async () => mock as any, invites as unknown as InvitationService);
    });

    it('returns null without calling the invitation service when no token was carried', async () => {
      expect(await service.claimInvitation({ id: 'user-1', user_metadata: {} })).toBeNull();
      expect(
        await service.claimInvitation({ id: 'user-1', user_metadata: { invite_token: '  ' } }),
      ).toBeNull();
      expect(invites.acceptInvitationForUser).not.toHaveBeenCalled();
    });

    it('accepts the invitation for the verified user and returns the org id', async () => {
      invites.acceptInvitationForUser.mockResolvedValueOnce(success(membership));

      const result = await service.claimInvitation(user);

      expect(result).toEqual({ orgId: 'org-1' });
      expect(invites.acceptInvitationForUser).toHaveBeenCalledWith('user-1', 'tok-1');
    });

    it('returns null when the invitation cannot be accepted', async () => {
      invites.acceptInvitationForUser.mockResolvedValueOnce(failure('GONE'));

      expect(await service.claimInvitation(user)).toBeNull();
    });

    it('swallows a thrown usage-limit error so activation still succeeds', async () => {
      invites.acceptInvitationForUser.mockRejectedValueOnce(new AppError('USAGE_LIMIT_EXCEEDED'));

      await expect(service.claimInvitation(user)).resolves.toBeNull();
    });
  });

  describe('login', () => {
    it('returns user when credentials are valid', async () => {
      const mockUser = { id: 'user-1', email: 'john@example.com' };
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: mockUser, session: { access_token: 'token' } },
        error: null,
      });

      const result = await service.login({
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.user).toEqual(mockUser);
      }
    });

    it('throws UNAUTHORIZED when credentials are invalid', async () => {
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid credentials' },
      });

      const result = await service.login({ email: 'john@example.com', password: 'wrong' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNAUTHORIZED');
    });

    it('throws INTERNAL_SERVER when user is null after successful login', async () => {
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const result = await service.login({ email: 'john@example.com', password: 'SecurePass1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('logout', () => {
    it('calls signOut with local scope', async () => {
      mock.auth.signOut.mockResolvedValueOnce({ error: null });

      const result = await service.logout();

      expect(result.success).toBe(true);
      expect(mock.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('throws INTERNAL_SERVER when signOut fails', async () => {
      mock.auth.signOut.mockResolvedValueOnce({ error: { message: 'error' } });

      const result = await service.logout();

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('requestPasswordReset', () => {
    it('calls resetPasswordForEmail', async () => {
      mock.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });

      const result = await service.requestPasswordReset('john@example.com');

      expect(result.success).toBe(true);
    });

    it('throws BAD_REQUEST when reset fails', async () => {
      mock.auth.resetPasswordForEmail.mockResolvedValueOnce({
        error: { message: 'error' },
      });

      const result = await service.requestPasswordReset('john@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });
  });

  describe('updatePassword', () => {
    const user = { id: 'user-1', email: 'john@example.com' };
    const now = () => Math.floor(Date.now() / 1000);

    it('verifies the current password before updating it', async () => {
      mock.auth.getUser.mockResolvedValueOnce({ data: { user }, error: null });
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user, session: { access_token: 'token' } },
        error: null,
      });
      mock.auth.updateUser.mockResolvedValueOnce({ error: null });

      const result = await service.updatePassword({
        currentPassword: 'OldPass1',
        password: 'NewSecure1',
      });

      expect(result.success).toBe(true);
      expect(mock.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'john@example.com',
        password: 'OldPass1',
      });
      expect(mock.auth.updateUser).toHaveBeenCalledWith({ password: 'NewSecure1' });
      expect(mock.auth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(
        mock.auth.updateUser.mock.invocationCallOrder[0],
      );
    });

    it('returns INVALID_CURRENT_PASSWORD and keeps the password when it is wrong', async () => {
      mock.auth.getUser.mockResolvedValueOnce({ data: { user }, error: null });
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 },
      });

      const result = await service.updatePassword({
        currentPassword: 'WrongPass1',
        password: 'NewSecure1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_CURRENT_PASSWORD');
      expect(mock.auth.updateUser).not.toHaveBeenCalled();
    });

    it('returns RATE_LIMITED when the re-authentication is rate limited', async () => {
      mock.auth.getUser.mockResolvedValueOnce({ data: { user }, error: null });
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: {
          code: 'over_request_rate_limit',
          message: 'Too many requests',
          status: 429,
        },
      });

      const result = await service.updatePassword({
        currentPassword: 'OldPass1',
        password: 'NewSecure1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('RATE_LIMITED');
      expect(mock.auth.updateUser).not.toHaveBeenCalled();
    });

    it('returns UNAUTHORIZED when the session has no e-mail', async () => {
      mock.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null });

      const result = await service.updatePassword({
        currentPassword: 'OldPass1',
        password: 'NewSecure1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNAUTHORIZED');
      expect(mock.auth.signInWithPassword).not.toHaveBeenCalled();
      expect(mock.auth.updateUser).not.toHaveBeenCalled();
    });

    it('allows the reset flow with a fresh otp session', async () => {
      mock.auth.getClaims.mockResolvedValueOnce({
        data: { claims: { amr: [{ method: 'otp', timestamp: now() - 60 }] } },
        error: null,
      });
      mock.auth.updateUser.mockResolvedValueOnce({ error: null });

      const result = await service.updatePassword({ password: 'NewSecure1' });

      expect(result.success).toBe(true);
      expect(mock.auth.signInWithPassword).not.toHaveBeenCalled();
      expect(mock.auth.updateUser).toHaveBeenCalledWith({ password: 'NewSecure1' });
    });

    it('rejects the reset flow when the session was not established via otp', async () => {
      mock.auth.getClaims.mockResolvedValueOnce({
        data: { claims: { amr: [{ method: 'password', timestamp: now() - 60 }] } },
        error: null,
      });

      const result = await service.updatePassword({ password: 'NewSecure1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
      expect(mock.auth.updateUser).not.toHaveBeenCalled();
    });

    it('rejects a stale otp session', async () => {
      mock.auth.getClaims.mockResolvedValueOnce({
        data: { claims: { amr: [{ method: 'otp', timestamp: now() - 31 * 60 }] } },
        error: null,
      });

      const result = await service.updatePassword({ password: 'NewSecure1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
      expect(mock.auth.updateUser).not.toHaveBeenCalled();
    });

    it('rejects when the claims cannot be read', async () => {
      mock.auth.getClaims.mockResolvedValueOnce({ data: null, error: { message: 'no session' } });

      const result = await service.updatePassword({ password: 'NewSecure1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
      expect(mock.auth.updateUser).not.toHaveBeenCalled();
    });

    it('rejects when the claims carry no session data', async () => {
      mock.auth.getClaims.mockResolvedValueOnce({ data: null, error: null });

      const result = await service.updatePassword({ password: 'NewSecure1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });

    it('rejects a string-only amr claim (no timestamp to prove freshness)', async () => {
      mock.auth.getClaims.mockResolvedValueOnce({
        data: { claims: { amr: ['otp'] } },
        error: null,
      });

      const result = await service.updatePassword({ password: 'NewSecure1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
      expect(mock.auth.updateUser).not.toHaveBeenCalled();
    });

    it('throws UNPROCESSABLE_ENTITY when same password', async () => {
      mock.auth.getUser.mockResolvedValueOnce({ data: { user }, error: null });
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user, session: { access_token: 'token' } },
        error: null,
      });
      mock.auth.updateUser.mockResolvedValueOnce({
        error: { code: 'same_password' },
      });

      const result = await service.updatePassword({
        currentPassword: 'OldPass1',
        password: 'OldPass1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('throws BAD_REQUEST when update fails with generic error', async () => {
      mock.auth.getUser.mockResolvedValueOnce({ data: { user }, error: null });
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user, session: { access_token: 'token' } },
        error: null,
      });
      mock.auth.updateUser.mockResolvedValueOnce({
        error: { message: 'Generic error' },
      });

      const result = await service.updatePassword({
        currentPassword: 'OldPass1',
        password: 'NewSecure1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });
  });
});
