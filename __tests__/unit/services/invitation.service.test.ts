import { AccountType, type RequestContext } from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { InvitationService } from '@studiq/server/services/invitation.service';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/services/limits.resolver', () => ({
  limitsResolver: {
    checkLimit: vi.fn().mockResolvedValue(undefined),
    checkOrgLimit: vi.fn().mockResolvedValue(undefined),
  },
}));

function qb(data: any, error: any = null) {
  const result = { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.upsert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.limit = vi.fn(() => b);
  b.or = vi.fn(() => b);
  b.not = vi.fn(() => b);
  b.neq = vi.fn(() => b);
  b.rpc = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('InvitationService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: InvitationService;

  const managerCtx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.MANAGER,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  const educatorCtx: RequestContext = {
    userId: 'test-user-id-2',
    accountType: AccountType.EDUCATOR,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: 'uni-1',
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  const studentCtx: RequestContext = {
    userId: 'test-user-id-3',
    accountType: AccountType.STUDENT,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new InvitationService(
      async () => mock as any,
      () => mock as any,
    );
  });

  describe('createInvitation', () => {
    it('creates invitation for manager with organizationId', async () => {
      mock.from.mockReturnValueOnce(qb({ token: 'abc123' }));

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
      vi.stubEnv('NODE_ENV', 'development');

      const result = await service.createInvitation(managerCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
        organizationId: 'uni-1',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).inviteLink).toContain('abc123');

      vi.unstubAllEnvs();
    });

    it('returns NOT_FOUND when manager has no organizationId', async () => {
      const result = await service.createInvitation(managerCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('creates invitation for educator with activeOrgId', async () => {
      mock.from.mockReturnValueOnce(qb({ token: 'abc123' }));

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
      vi.stubEnv('NODE_ENV', 'development');

      const result = await service.createInvitation(educatorCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).success).toBe(true);

      vi.unstubAllEnvs();
    });

    it('returns FORBIDDEN for student account type', async () => {
      const result = await service.createInvitation(studentCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns INTERNAL_SERVER when SITE_URL is not set', async () => {
      mock.from.mockReturnValueOnce(qb({ token: 'abc123' }));

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');

      const result = await service.createInvitation(
        { ...managerCtx, activeOrgId: 'uni-1' },
        { email: 'john@example.com', targetOrgRoleId: 'member' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');

      vi.unstubAllEnvs();
    });

    it('returns INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

      const result = await service.createInvitation(
        { ...managerCtx, activeOrgId: 'uni-1' },
        { email: 'john@example.com', targetOrgRoleId: 'member' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');

      vi.unstubAllEnvs();
    });
  });

  /** Invitation row as loadInvite() selects it. */
  function inviteRow(overrides: Record<string, unknown> = {}) {
    return {
      email: 'john@example.com',
      inviter_id: 'manager-1',
      is_accepted: false,
      organization_id: 'uni-1',
      target_org_role_id: 'role-member',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      organizations: { name: 'Test Uni' } as any,
      org_roles: { name: 'Member', organization_id: 'uni-1' } as any,
      ...overrides,
    };
  }

  describe('getInvitationByToken', () => {
    beforeEach(() => {
      mock.rpc.mockResolvedValue({ data: true, error: null });
    });

    it('returns invitation when found and valid', async () => {
      mock.from.mockReturnValueOnce(qb(inviteRow()));

      const result = await service.getInvitationByToken('valid-token');

      expect(result.success).toBe(true);
      expect((result.data as any).email).toBe('john@example.com');
      // The inviter identity is never exposed to the public preview.
      expect((result.data as any).inviterId).toBeUndefined();
      expect(mock.rpc).toHaveBeenCalledWith('can_assign_org_role', {
        p_actor: 'manager-1',
        p_role_id: 'role-member',
      });
    });

    it('returns NOT_FOUND when token does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getInvitationByToken('invalid');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns GONE when token is expired', async () => {
      mock.from.mockReturnValueOnce(
        qb(inviteRow({ expires_at: new Date(Date.now() - 86400000).toISOString() })),
      );

      const result = await service.getInvitationByToken('expired');

      expect(result.success).toBe(false);
      expect(result.error).toBe('GONE');
    });

    it('returns GONE when the invitation was already accepted (B6)', async () => {
      mock.from.mockReturnValueOnce(qb(inviteRow({ is_accepted: true })));

      const result = await service.getInvitationByToken('used');

      expect(result.success).toBe(false);
      expect(result.error).toBe('GONE');
      expect(mock.rpc).not.toHaveBeenCalled();
    });

    it('returns GONE when the target role belongs to another organization', async () => {
      mock.from.mockReturnValueOnce(
        qb(inviteRow({ org_roles: { name: 'Member', organization_id: 'other-org' } })),
      );

      const result = await service.getInvitationByToken('foreign-role');

      expect(result.success).toBe(false);
      expect(result.error).toBe('GONE');
    });

    it('returns GONE when the inviter may no longer assign the role', async () => {
      mock.from.mockReturnValueOnce(qb(inviteRow()));
      mock.rpc.mockResolvedValue({ data: false, error: null });

      const result = await service.getInvitationByToken('demoted-inviter');

      expect(result.success).toBe(false);
      expect(result.error).toBe('GONE');
    });
  });

  describe('acceptInvitation', () => {
    const invitation = inviteRow({
      email: 'new@example.com',
      organization_id: 'org-1',
      target_org_role_id: 'role-member',
      organizations: { name: 'Test Org' } as any,
      org_roles: { name: 'member', organization_id: 'org-1' } as any,
    });
    const joiningCtx: RequestContext = { ...managerCtx, userId: 'joining-user' };

    function adminClient() {
      const from = vi.fn();
      const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
      return { client: { from, rpc } as any, from, rpc };
    }

    /** Chain that answers the `org_members` seat count (`.neq(...)`). */
    function countQb(count: number | null, error: unknown = null) {
      const c: any = {};
      c.select = vi.fn(() => c);
      c.eq = vi.fn(() => c);
      c.neq = vi.fn().mockResolvedValue({ count, error });
      return c;
    }

    it('runs the whole accept flow on the admin client, not the joining user (#191)', async () => {
      const admin = adminClient();
      admin.from
        .mockReturnValueOnce(qb(invitation)) // invitation token lookup
        .mockReturnValueOnce(countQb(5)); // seat count
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );
      vi.mocked(limitsResolver.checkOrgLimit).mockRejectedValueOnce(
        new AppError('USAGE_LIMIT_EXCEEDED'),
      );

      await expect(service.acceptInvitation(joiningCtx, 'tok')).rejects.toThrow();

      expect(admin.from).toHaveBeenNthCalledWith(1, 'invitations');
      expect(admin.from).toHaveBeenNthCalledWith(2, 'org_members');
      expect(limitsResolver.checkOrgLimit).toHaveBeenCalledWith(
        'org-1',
        'max_students',
        5,
        1,
        admin.client,
      );
      // The accepting user is not a member yet: RLS would hide every row, so the
      // user-session client must not be touched at all.
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('adds the member when the organization is below its limit', async () => {
      const admin = adminClient();
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );
      admin.from
        .mockReturnValueOnce(qb(invitation))
        .mockReturnValueOnce(countQb(2))
        .mockReturnValueOnce(qb({ id: 'org-1', name: 'Test Org' }))
        .mockReturnValueOnce(qb({ organization_id: 'org-1' }))
        .mockReturnValueOnce(qb({ id: 'group-1' }))
        .mockReturnValue(qb(null));

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(true);
      expect(limitsResolver.checkOrgLimit).toHaveBeenCalledWith(
        'org-1',
        'max_students',
        2,
        1,
        admin.client,
      );
    });

    it('returns a DB failure when the member count cannot be read', async () => {
      const admin = adminClient();
      admin.from
        .mockReturnValueOnce(qb(invitation))
        .mockReturnValueOnce(countQb(null, { message: 'boom', code: 'XX000' }));
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
      expect(limitsResolver.checkOrgLimit).not.toHaveBeenCalled();
    });

    it('re-accepting as an existing member does not consume a second seat (#182)', async () => {
      // Org is full with the caller already inside: 4 other members + the caller = 5/5.
      const admin = adminClient();
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );
      const memberQb = qb({ organization_id: 'org-1' });
      const groupQb = qb(null);
      admin.from
        .mockReturnValueOnce(qb(invitation))
        .mockReturnValueOnce(countQb(4))
        .mockReturnValueOnce(qb({ id: 'org-1', name: 'Test Org' }))
        .mockReturnValueOnce(memberQb)
        .mockReturnValueOnce(qb({ id: 'group-1' }))
        .mockReturnValueOnce(groupQb)
        .mockReturnValue(qb(null));

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(true);
      expect(limitsResolver.checkOrgLimit).toHaveBeenCalledWith(
        'org-1',
        'max_students',
        4,
        1,
        admin.client,
      );
      // The membership "upsert" needs the composite target, otherwise it degrades
      // to an INSERT and a re-accept fails with 23505 on (organization_id, user_id).
      expect(memberQb.upsert).toHaveBeenCalledWith(
        { organization_id: 'org-1', user_id: 'joining-user', org_role_id: 'role-member' },
        { onConflict: 'organization_id,user_id' },
      );
      expect(groupQb.upsert).toHaveBeenCalledWith(
        { group_id: 'group-1', user_id: 'joining-user', role: 'member' },
        { onConflict: 'group_id,user_id', ignoreDuplicates: true },
      );
    });

    it('refuses to accept when the inviter may no longer assign the role (B1)', async () => {
      const admin = adminClient();
      admin.rpc.mockResolvedValue({ data: false, error: null });
      admin.from.mockReturnValueOnce(qb(invitation));
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(false);
      expect(result.error).toBe('GONE');
      expect(admin.rpc).toHaveBeenCalledWith('can_assign_org_role', {
        p_actor: 'manager-1',
        p_role_id: 'role-member',
      });
      // No seat count, no membership upsert: the token did nothing.
      expect(admin.from).toHaveBeenCalledTimes(1);
      expect(limitsResolver.checkOrgLimit).not.toHaveBeenCalled();
    });

    it('treats an authority-RPC error as an invalid invitation (GONE)', async () => {
      const admin = adminClient();
      admin.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } });
      admin.from.mockReturnValueOnce(qb(invitation));
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(false);
      expect(result.error).toBe('GONE');
      expect(admin.from).toHaveBeenCalledTimes(1);
    });

    it('rejects an already-accepted token and never re-upserts membership (B6)', async () => {
      const admin = adminClient();
      admin.from.mockReturnValueOnce(qb(inviteRow({ ...invitation, is_accepted: true })));
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(false);
      expect(result.error).toBe('GONE');
      expect(admin.from).toHaveBeenCalledTimes(1);
      expect(limitsResolver.checkOrgLimit).not.toHaveBeenCalled();
    });

    it('rejects an invitation whose target role belongs to another organization', async () => {
      const admin = adminClient();
      admin.from.mockReturnValueOnce(
        qb(inviteRow({ ...invitation, org_roles: { name: 'admin', organization_id: 'org-2' } })),
      );
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(false);
      expect(result.error).toBe('GONE');
      expect(admin.from).toHaveBeenCalledTimes(1);
    });

    it('marks the invitation accepted only while it is still unaccepted', async () => {
      const admin = adminClient();
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );
      const acceptQb = qb(null);
      admin.from
        .mockReturnValueOnce(qb(invitation))
        .mockReturnValueOnce(countQb(2))
        .mockReturnValueOnce(qb({ id: 'org-1', name: 'Test Org' }))
        .mockReturnValueOnce(qb({ organization_id: 'org-1' }))
        .mockReturnValueOnce(qb({ id: 'group-1' }))
        .mockReturnValueOnce(qb(null))
        .mockReturnValueOnce(acceptQb);

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(true);
      // Single-use guard: the update only matches an unaccepted row.
      expect(acceptQb.update).toHaveBeenCalledWith({ is_accepted: true });
      expect(acceptQb.eq).toHaveBeenCalledWith('is_accepted', false);
    });
  });

  // MGR-INV-03: an invitation id alone must never authorize a write. The
  // caller has to prove membership of the active org (orgRoleId) and the row
  // must belong to that org.
  describe('deleteInvitation', () => {
    const scopedCtx: RequestContext = {
      ...managerCtx,
      activeOrgId: 'org-a',
      orgRoleId: 'role-a',
    };

    it('returns NOT_FOUND and never deletes an invitation of another organization', async () => {
      const fetch = qb(null);
      mock.from.mockReturnValueOnce(fetch);

      const result = await service.deleteInvitation(scopedCtx, 'foreign-invite');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      expect(fetch.eq).toHaveBeenCalledWith('id', 'foreign-invite');
      expect(fetch.eq).toHaveBeenCalledWith('organization_id', 'org-a');
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(fetch.delete).not.toHaveBeenCalled();
    });

    it('deletes a pending invitation of the active organization', async () => {
      const fetch = qb({ id: 'invite-1', is_accepted: false });
      const del = qb(null);
      mock.from.mockReturnValueOnce(fetch).mockReturnValueOnce(del);

      const result = await service.deleteInvitation(scopedCtx, 'invite-1');

      expect(result.success).toBe(true);
      expect(del.delete).toHaveBeenCalled();
      expect(del.eq).toHaveBeenCalledWith('id', 'invite-1');
      expect(del.eq).toHaveBeenCalledWith('organization_id', 'org-a');
    });

    it('refuses to delete an accepted invitation', async () => {
      const fetch = qb({ id: 'invite-1', is_accepted: true });
      mock.from.mockReturnValueOnce(fetch);

      const result = await service.deleteInvitation(scopedCtx, 'invite-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(fetch.delete).not.toHaveBeenCalled();
    });

    it('returns FORBIDDEN without querying when there is no active organization', async () => {
      const result = await service.deleteInvitation(
        { ...scopedCtx, activeOrgId: null },
        'invite-1',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('returns FORBIDDEN for a forged active_org_id cookie (no membership row)', async () => {
      // activeOrgId is client-controlled; only orgRoleId proves membership.
      const result = await service.deleteInvitation({ ...scopedCtx, orgRoleId: null }, 'invite-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).not.toHaveBeenCalled();
    });
  });

  describe('updateInvitation', () => {
    const scopedCtx: RequestContext = {
      ...managerCtx,
      activeOrgId: 'org-a',
      orgRoleId: 'role-a',
    };

    it('returns NOT_FOUND and never updates an invitation of another organization', async () => {
      const fetch = qb(null);
      mock.from.mockReturnValueOnce(fetch);

      const result = await service.updateInvitation(scopedCtx, 'foreign-invite', {
        targetOrgRoleId: 'role-a',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      expect(fetch.eq).toHaveBeenCalledWith('organization_id', 'org-a');
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(fetch.update).not.toHaveBeenCalled();
    });

    it('rejects a target role that belongs to another organization', async () => {
      const fetch = qb({ id: 'invite-1', is_accepted: false });
      const roleLookup = qb(null);
      mock.from.mockReturnValueOnce(fetch).mockReturnValueOnce(roleLookup);

      const result = await service.updateInvitation(scopedCtx, 'invite-1', {
        targetOrgRoleId: 'foreign-role',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(roleLookup.eq).toHaveBeenCalledWith('id', 'foreign-role');
      expect(roleLookup.eq).toHaveBeenCalledWith('organization_id', 'org-a');
      expect(roleLookup.update).not.toHaveBeenCalled();
      expect(mock.from).toHaveBeenCalledTimes(2);
    });

    it('updates the role of a pending invitation of the active organization', async () => {
      const fetch = qb({ id: 'invite-1', is_accepted: false });
      const roleLookup = qb({ id: 'role-a' });
      const update = qb(null);
      mock.from
        .mockReturnValueOnce(fetch)
        .mockReturnValueOnce(roleLookup)
        .mockReturnValueOnce(update);

      const result = await service.updateInvitation(scopedCtx, 'invite-1', {
        targetOrgRoleId: 'role-a',
      });

      expect(result.success).toBe(true);
      expect(update.update).toHaveBeenCalledWith({ target_org_role_id: 'role-a' });
      expect(update.eq).toHaveBeenCalledWith('id', 'invite-1');
      expect(update.eq).toHaveBeenCalledWith('organization_id', 'org-a');
    });

    it('does nothing when there is no field to update', async () => {
      const fetch = qb({ id: 'invite-1', is_accepted: false });
      mock.from.mockReturnValueOnce(fetch);

      const result = await service.updateInvitation(scopedCtx, 'invite-1', {});

      expect(result.success).toBe(true);
      expect(fetch.update).not.toHaveBeenCalled();
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('refuses to update an accepted invitation', async () => {
      const fetch = qb({ id: 'invite-1', is_accepted: true });
      mock.from.mockReturnValueOnce(fetch);

      const result = await service.updateInvitation(scopedCtx, 'invite-1', {
        targetOrgRoleId: 'role-a',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(fetch.update).not.toHaveBeenCalled();
    });

    it('returns FORBIDDEN when there is no active organization or membership', async () => {
      const noOrg = await service.updateInvitation(
        { ...scopedCtx, activeOrgId: null },
        'invite-1',
        { targetOrgRoleId: 'role-a' },
      );
      const forgedCookie = await service.updateInvitation(
        { ...scopedCtx, orgRoleId: null },
        'invite-1',
        { targetOrgRoleId: 'role-a' },
      );

      expect(noOrg.success).toBe(false);
      expect(noOrg.error).toBe('FORBIDDEN');
      expect(forgedCookie.success).toBe(false);
      expect(forgedCookie.error).toBe('FORBIDDEN');
      expect(mock.from).not.toHaveBeenCalled();
    });
  });
});
