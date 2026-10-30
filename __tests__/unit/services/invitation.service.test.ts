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
    // The grant-authority RPC (#189) sits between the role lookup and the
    // insert; happy-path tests are allowed to grant by default.
    mock.rpc.mockResolvedValue({ data: true, error: null });
    service = new InvitationService(
      async () => mock as any,
      () => mock as any,
    );
  });

  describe('createInvitation', () => {
    /**
     * A successful create runs three reads/writes in order: membership,
     * role-in-org, insert. Returns the builders so a test can assert the
     * scoping and payload of each step.
     */
    function createBuilders({
      membership = { organization_id: 'uni-1' } as any,
      role = { id: 'member' } as any,
      insert = { id: 'inv-1', token: 'abc123' } as any,
      insertError = null as any,
    } = {}) {
      const membershipQb = qb(membership);
      const roleQb = qb(role);
      const insertQb = qb(insert, insertError);
      mock.from
        .mockReturnValueOnce(membershipQb)
        .mockReturnValueOnce(roleQb)
        .mockReturnValueOnce(insertQb);
      return { membershipQb, roleQb, insertQb };
    }

    it('creates an invitation when organizationId matches a membership', async () => {
      const { membershipQb, roleQb, insertQb } = createBuilders();

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
      // #313: the link is the only delivery path, so it must be returned in a
      // production build too — not just under NODE_ENV=development.
      vi.stubEnv('NODE_ENV', 'production');

      const result = await service.createInvitation(managerCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
        organizationId: 'uni-1',
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        success: true,
        invitationId: 'inv-1',
        inviteLink: 'http://localhost:3000/join?token=abc123',
        inviteCode: 'abc123',
      });
      expect((result.data as any).invitationId).toBe('inv-1');

      // The membership probe is scoped to the caller AND the target org.
      expect(membershipQb.eq).toHaveBeenCalledWith('organization_id', 'uni-1');
      expect(membershipQb.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
      // The granted role must belong to that same org.
      expect(roleQb.eq).toHaveBeenCalledWith('id', 'member');
      expect(roleQb.eq).toHaveBeenCalledWith('organization_id', 'uni-1');
      expect(insertQb.insert).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: 'uni-1', target_org_role_id: 'member' }),
      );

      vi.unstubAllEnvs();
    });

    // #242: body-supplied organizationId must never extend the caller's tenant.
    it('returns FORBIDDEN for a foreign organizationId and writes nothing', async () => {
      const membership = qb(null);
      mock.from.mockReturnValueOnce(membership);

      const result = await service.createInvitation(
        { ...managerCtx, activeOrgId: 'org-own', orgRoleId: 'role-own' },
        {
          email: 'qa-cross-org-ag@example.com',
          targetOrgRoleId: 'foreign-member-role',
          organizationId: 'org-foreign',
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(membership.eq).toHaveBeenCalledWith('organization_id', 'org-foreign');
      // No role lookup, no insert: the request stopped at the tenant boundary.
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('invitations');
    });

    // #242: active_org_id is a client-controlled cookie, so the cookie axis
    // must be closed too — not just the body field.
    it('returns FORBIDDEN for a forged active_org_id cookie and writes nothing', async () => {
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.createInvitation(
        { ...managerCtx, activeOrgId: 'org-foreign', orgRoleId: null },
        { email: 'qa-cookie-spoof@example.com', targetOrgRoleId: 'foreign-member-role' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('invitations');
    });

    // #242 control (issue's UE Wrocław case): a member org that is not the
    // active org is still a valid target.
    it('creates an invitation in a member org that is not the active org', async () => {
      const { insertQb } = createBuilders({
        membership: { organization_id: 'org-ue' },
      });

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

      const result = await service.createInvitation(
        { ...managerCtx, activeOrgId: 'org-wsb', orgRoleId: 'role-wsb' },
        {
          email: 'qa-control-ue@example.com',
          targetOrgRoleId: 'ue-member-role',
          organizationId: 'org-ue',
        },
      );

      expect(result.success).toBe(true);
      expect(insertQb.insert).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: 'org-ue' }),
      );

      vi.unstubAllEnvs();
    });

    // #242: a role from another org would leak that tenant's permission scopes
    // into the target org on accept.
    it('returns FORBIDDEN when the target role belongs to another organization', async () => {
      createBuilders({ role: null });

      const result = await service.createInvitation(managerCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'foreign-role',
        organizationId: 'uni-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).toHaveBeenCalledTimes(2);
      expect(mock.from).not.toHaveBeenCalledWith('invitations');
    });

    // #189: grant authority is evaluated by the endpoint itself, before the
    // write — not just inferred from the INSERT policy.
    it('returns FORBIDDEN when the caller may not grant the target role (#189)', async () => {
      const { insertQb } = createBuilders();
      mock.rpc.mockResolvedValue({ data: false, error: null });

      const result = await service.createInvitation(managerCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
        organizationId: 'uni-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.rpc).toHaveBeenCalledWith('can_assign_org_role', {
        p_actor: 'test-user-id',
        p_role_id: 'member',
      });
      expect(insertQb.insert).not.toHaveBeenCalled();
    });

    // A failed authority RPC must fail closed, never fall through to the insert.
    it('returns INTERNAL_SERVER when the authority RPC errors (#189)', async () => {
      const { insertQb } = createBuilders();
      mock.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } });

      const result = await service.createInvitation(managerCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
        organizationId: 'uni-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
      expect(insertQb.insert).not.toHaveBeenCalled();
    });

    it('returns FORBIDDEN when manager has no organizationId and no active org', async () => {
      const result = await service.createInvitation(managerCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('creates invitation for educator with activeOrgId', async () => {
      const { insertQb } = createBuilders();

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

      const result = await service.createInvitation(educatorCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
      });

      expect(result.success).toBe(true);
      expect((result.data as any).success).toBe(true);
      expect(insertQb.insert).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: 'uni-1' }),
      );

      vi.unstubAllEnvs();
    });

    it('returns FORBIDDEN for student account type', async () => {
      const result = await service.createInvitation(studentCtx, {
        email: 'john@example.com',
        targetOrgRoleId: 'member',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('returns INTERNAL_SERVER when SITE_URL is not set and writes nothing', async () => {
      const { insertQb } = createBuilders();

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');

      const result = await service.createInvitation(
        { ...managerCtx, activeOrgId: 'uni-1' },
        { email: 'john@example.com', targetOrgRoleId: 'member' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
      // The guard runs before the INSERT: no orphan "Oczekujące" row that can
      // never be delivered (#313).
      expect(insertQb.insert).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    });

    it('returns INTERNAL_SERVER when insert fails', async () => {
      createBuilders({ insert: null, insertError: { message: 'DB error' } });

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

  // MGR-INV-02: bulk is all-or-nothing. Every entry is checked before any write
  // and the rows land in a single INSERT, so a rejected entry cannot leave a
  // half-sent batch behind.
  describe('createInvitationsBulk', () => {
    const memberRole = '550e8400-e29b-41d4-a716-446655440001';
    const adminRole = '550e8400-e29b-41d4-a716-446655440002';

    function bulkBuilders({
      membership = { organization_id: 'uni-1' } as any,
      roles = [{ id: memberRole }, { id: adminRole }] as any,
      rolesError = null as any,
      created = [
        { id: 'inv-2', token: 'token-2', email: 'jane@example.com' },
        { id: 'inv-1', token: 'token-1', email: 'john@example.com' },
      ] as any,
      insertError = null as any,
    } = {}) {
      const membershipQb = qb(membership);
      const rolesQb = qb(roles, rolesError);
      const insertQb = qb(created, insertError);
      mock.from
        .mockReturnValueOnce(membershipQb)
        .mockReturnValueOnce(rolesQb)
        .mockReturnValueOnce(insertQb);
      return { membershipQb, rolesQb, insertQb };
    }

    const invitations = [
      { email: 'john@example.com', targetOrgRoleId: memberRole },
      { email: 'jane@example.com', targetOrgRoleId: adminRole },
    ];

    it('inserts every row in one statement and returns the results in input order', async () => {
      const { rolesQb, insertQb } = bulkBuilders();

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
      // #313: every row carries its own copyable link, production included.
      vi.stubEnv('NODE_ENV', 'production');

      const result = await service.createInvitationsBulk(
        { ...managerCtx, activeOrgId: 'uni-1' },
        invitations,
      );

      expect(result.success).toBe(true);
      const results = (result as any).data as Array<{
        email: string;
        success: boolean;
        data: { invitationId: string; inviteLink: string; inviteCode: string };
      }>;
      // The DB returned the rows in a different order: mapping must follow the
      // request order, not the insert response order.
      expect(results.map((r) => r.data.invitationId)).toEqual(['inv-1', 'inv-2']);
      // Per-row attribution: each address gets the link for its own token.
      expect(results[0].data.inviteLink).toBe('http://localhost:3000/join?token=token-1');
      expect(results[1].data.inviteLink).toBe('http://localhost:3000/join?token=token-2');
      // The bare code is returned alongside the link, so it can be copied too.
      expect(results[0].data.inviteCode).toBe('token-1');
      expect(results[1].data.inviteCode).toBe('token-2');
      // MGR-INV-02: every result names the address it belongs to, in input order.
      expect(results.map((r) => r.email)).toEqual(['john@example.com', 'jane@example.com']);

      // One role pre-flight query, scoped to the resolved org.
      expect(rolesQb.eq).toHaveBeenCalledWith('organization_id', 'uni-1');
      expect(rolesQb.in).toHaveBeenCalledWith('id', [memberRole, adminRole]);

      // One multi-row INSERT: same expires_at for all rows.
      expect(insertQb.insert).toHaveBeenCalledTimes(1);
      const rows = insertQb.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        email: 'john@example.com',
        target_org_role_id: memberRole,
        organization_id: 'uni-1',
        inviter_id: 'test-user-id',
      });
      expect(rows[0].expires_at).toBe(rows[1].expires_at);

      vi.unstubAllEnvs();
    });

    it('labels duplicate addresses individually instead of collapsing them', async () => {
      bulkBuilders({
        created: [
          { id: 'inv-3', token: 'token-3', email: 'john@example.com' },
          { id: 'inv-1', token: 'token-1', email: 'john@example.com' },
          { id: 'inv-2', token: 'token-2', email: 'jane@example.com' },
        ] as any,
      });

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

      const result = await service.createInvitationsBulk({ ...managerCtx, activeOrgId: 'uni-1' }, [
        invitations[0],
        invitations[1],
        invitations[0],
      ]);

      expect(result.success).toBe(true);
      const results = (result as any).data as Array<{
        email: string;
        data: { invitationId: string };
      }>;
      expect(results.map((r) => r.email)).toEqual([
        'john@example.com',
        'jane@example.com',
        'john@example.com',
      ]);
      // Still one distinct invitation (and link) per submitted row.
      expect(new Set(results.map((r) => r.data.invitationId)).size).toBe(3);

      vi.unstubAllEnvs();
    });

    it('returns UNPROCESSABLE_ENTITY naming an unknown/foreign role and writes nothing', async () => {
      const { insertQb } = bulkBuilders({ roles: [{ id: memberRole }] });

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

      const result = await service.createInvitationsBulk(
        { ...managerCtx, activeOrgId: 'uni-1' },
        invitations,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect((result as any).details).toEqual([
        expect.objectContaining({
          message: 'VALIDATION_INVALID_ROLE',
          path: ['invitations', 1, 'targetOrgRoleId'],
        }),
      ]);
      expect(insertQb.insert).not.toHaveBeenCalled();
      expect(mock.from).not.toHaveBeenCalledWith('invitations');

      vi.unstubAllEnvs();
    });

    // #189: every distinct granted role is checked before the write; one
    // un-grantable role rejects the whole batch (all-or-nothing, like the 422).
    it('returns FORBIDDEN and writes nothing when the caller may not grant a target role (#189)', async () => {
      const { insertQb } = bulkBuilders();
      mock.rpc.mockImplementation(async (_fn: string, args: { p_role_id: string }) => ({
        data: args.p_role_id === memberRole,
        error: null,
      }));

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

      const result = await service.createInvitationsBulk(
        { ...managerCtx, activeOrgId: 'uni-1' },
        invitations,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(insertQb.insert).not.toHaveBeenCalled();
      expect(mock.rpc).toHaveBeenCalledTimes(2);
      expect(mock.rpc).toHaveBeenNthCalledWith(1, 'can_assign_org_role', {
        p_actor: 'test-user-id',
        p_role_id: memberRole,
      });
      expect(mock.rpc).toHaveBeenNthCalledWith(2, 'can_assign_org_role', {
        p_actor: 'test-user-id',
        p_role_id: adminRole,
      });

      vi.unstubAllEnvs();
    });

    it('checks each distinct target role only once (#189)', async () => {
      bulkBuilders({
        created: [
          { id: 'inv-1', token: 'token-1', email: 'john@example.com' },
          { id: 'inv-2', token: 'token-2', email: 'jane@example.com' },
          { id: 'inv-3', token: 'token-3', email: 'john@example.com' },
        ] as any,
      });

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

      const result = await service.createInvitationsBulk({ ...managerCtx, activeOrgId: 'uni-1' }, [
        invitations[0],
        invitations[1],
        invitations[0],
      ]);

      expect(result.success).toBe(true);
      expect(mock.rpc).toHaveBeenCalledTimes(2);

      vi.unstubAllEnvs();
    });

    it('returns UNPROCESSABLE_ENTITY when entries point at different organizations', async () => {
      mock.from.mockReturnValueOnce(qb({ organization_id: 'uni-1' }));

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

      const result = await service.createInvitationsBulk({ ...managerCtx, activeOrgId: 'uni-1' }, [
        { ...invitations[0], organizationId: 'uni-1' },
        { ...invitations[1], organizationId: 'uni-2' },
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect((result as any).details).toEqual([
        expect.objectContaining({
          message: 'VALIDATION_INVALID_INPUT',
          path: ['invitations', 1, 'organizationId'],
        }),
      ]);
      // Stopped at the tenant boundary: no role lookup, no insert.
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('org_roles');
      expect(mock.from).not.toHaveBeenCalledWith('invitations');

      vi.unstubAllEnvs();
    });

    it('returns FORBIDDEN when the caller is not a member of the target org', async () => {
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.createInvitationsBulk(
        { ...managerCtx, activeOrgId: 'org-foreign' },
        invitations,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('invitations');
    });

    it('returns INTERNAL_SERVER when SITE_URL is missing and writes nothing', async () => {
      bulkBuilders();

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');

      const result = await service.createInvitationsBulk(
        { ...managerCtx, activeOrgId: 'uni-1' },
        invitations,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
      expect(mock.from).not.toHaveBeenCalledWith('invitations');

      vi.unstubAllEnvs();
    });

    it('returns INTERNAL_SERVER when the single insert fails', async () => {
      bulkBuilders({ created: null, insertError: { message: 'DB error' } });

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

      const result = await service.createInvitationsBulk(
        { ...managerCtx, activeOrgId: 'uni-1' },
        invitations,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');

      vi.unstubAllEnvs();
    });

    // A role policy denial fails the whole statement, so nothing is written.
    it('returns FORBIDDEN when RLS denies the batch insert', async () => {
      bulkBuilders({ created: null, insertError: { message: 'denied', code: '42501' } });

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');

      const result = await service.createInvitationsBulk(
        { ...managerCtx, activeOrgId: 'uni-1' },
        invitations,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');

      vi.unstubAllEnvs();
    });
  });

  describe('listInvitations', () => {
    it('returns FORBIDDEN when the active org is not a membership', async () => {
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.listInvitations({
        ...managerCtx,
        activeOrgId: 'org-foreign',
        orgRoleId: null,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).not.toHaveBeenCalledWith('invitations');
    });

    it('returns FORBIDDEN without querying when there is no active org', async () => {
      const result = await service.listInvitations(managerCtx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('lists only the verified active organization', async () => {
      mock.from.mockReturnValueOnce(qb({ organization_id: 'org-a' }));
      const list = qb([]);
      mock.from.mockReturnValueOnce(list);

      const result = await service.listInvitations({ ...managerCtx, activeOrgId: 'org-a' });

      expect(result.success).toBe(true);
      expect(list.eq).toHaveBeenCalledWith('organization_id', 'org-a');
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

    // #317: „Kopiuj link” copies a URL, but this field asks for the 32-hex code.
    // The preview must look up the code inside the link, never the URL itself.
    it('extracts the bare code from the pasted „Kopiuj link” URL', async () => {
      const code = 'c8a0b04e7082116c09a28ce717f83d5f';
      const query = qb(inviteRow());
      mock.from.mockReturnValueOnce(query);

      const result = await service.getInvitationByToken(
        `  http://localhost:3012/join?token=${code.toUpperCase()}  `,
      );

      expect(result.success).toBe(true);
      // Uppercase hex is folded to the lowercase column value.
      expect(query.eq).toHaveBeenCalledWith('token', code);
      expect(query.eq).not.toHaveBeenCalledWith('token', expect.stringContaining('http'));
    });

    it('returns NOT_FOUND without querying for a link that carries no token', async () => {
      const result = await service.getInvitationByToken('http://localhost:3012/join');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND without querying for an empty token', async () => {
      const result = await service.getInvitationByToken('   ');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      expect(mock.from).not.toHaveBeenCalled();
    });

    // #236: the public preview is unauthenticated, so the request-scoped client
    // would run as `anon` and PostgREST rejects `public.invitations` with 42501.
    // The preview must resolve on the service-role client only.
    it('resolves the public preview on the admin client, never the request client (#236)', async () => {
      const requestClient = vi.fn(async () => {
        throw new Error('request-scoped client must not be used for a public preview');
      });
      const admin = {
        from: vi.fn(() => qb(inviteRow())),
        rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      };
      service = new InvitationService(requestClient as any, () => admin as any);

      const result = await service.getInvitationByToken('public-token');

      expect(result.success).toBe(true);
      expect((result.data as any).email).toBe('john@example.com');
      expect(requestClient).not.toHaveBeenCalled();
      expect(admin.from).toHaveBeenCalledWith('invitations');
      expect(admin.rpc).toHaveBeenCalledWith('can_assign_org_role', {
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
      // A full org must not burn the token: the claim is never attempted.
      expect(admin.from).toHaveBeenCalledTimes(2);
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
        .mockReturnValueOnce(qb({ id: 'inv-1' })) // claim
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

    it('tells the inviter that the invitation was accepted (#664)', async () => {
      const admin = adminClient();
      const notifier = { invitationAccepted: vi.fn().mockResolvedValue(undefined) };
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
        () => null,
        notifier as any,
      );
      admin.from
        .mockReturnValueOnce(qb(invitation))
        .mockReturnValueOnce(countQb(2))
        .mockReturnValueOnce(qb({ id: 'org-1', name: 'Test Org' }))
        .mockReturnValueOnce(qb({ id: 'inv-1' })) // claim
        .mockReturnValueOnce(qb({ organization_id: 'org-1' }))
        .mockReturnValueOnce(qb({ id: 'group-1' }))
        .mockReturnValue(qb(null));

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(true);
      expect(notifier.invitationAccepted).toHaveBeenCalledOnce();
      expect(notifier.invitationAccepted).toHaveBeenCalledWith({
        inviterId: 'manager-1',
        memberId: 'joining-user',
        organizationId: 'org-1',
      });
    });

    it('does not notify anybody when the accept is refused (full organization)', async () => {
      const admin = adminClient();
      const notifier = { invitationAccepted: vi.fn().mockResolvedValue(undefined) };
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
        () => null,
        notifier as any,
      );
      admin.from.mockReturnValueOnce(qb(invitation)).mockReturnValueOnce(countQb(5));
      vi.mocked(limitsResolver.checkOrgLimit).mockRejectedValueOnce(
        new AppError('USAGE_LIMIT_EXCEEDED'),
      );

      await expect(service.acceptInvitation(joiningCtx, 'tok')).rejects.toThrow();

      expect(notifier.invitationAccepted).not.toHaveBeenCalled();
    });

    it('accepts by user id for the activation callback (#311)', async () => {
      // Same flow as `acceptInvitation`, but addressed by user id: the callback
      // has a verified Supabase user and no withAuth() RequestContext.
      const admin = adminClient();
      const count = countQb(1);
      admin.from
        .mockReturnValueOnce(qb(invitation))
        .mockReturnValueOnce(count)
        .mockReturnValueOnce(qb({ id: 'org-1', name: 'Test Org' }))
        .mockReturnValueOnce(qb({ id: 'inv-1' })) // single-use claim
        .mockReturnValueOnce(qb({ organization_id: 'org-1' }))
        .mockReturnValueOnce(qb({ id: 'group-1' }))
        .mockReturnValue(qb(null));
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );

      const result = await service.acceptInvitationForUser('joining-user', 'tok');

      expect(result).toEqual({
        success: true,
        data: { id: 'org-1', name: 'Test Org', orgRoleId: 'role-member' },
      });
      // The invitee (not the inviter, not the caller's ctx) is the member-insert
      // subject and is excluded from the seat count.
      expect(count.neq).toHaveBeenCalledWith('user_id', 'joining-user');
      expect(limitsResolver.checkOrgLimit).toHaveBeenCalledWith(
        'org-1',
        'max_students',
        1,
        1,
        admin.client,
      );
      expect(mock.from).not.toHaveBeenCalled();
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
        .mockReturnValueOnce(qb({ id: 'inv-1' })) // claim
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

    it('claims the token before writing membership and never re-updates it afterwards', async () => {
      const admin = adminClient();
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );
      const claimQb = qb({ id: 'inv-1' });
      const memberQb = qb(null);
      admin.from
        .mockReturnValueOnce(qb(invitation))
        .mockReturnValueOnce(countQb(2))
        .mockReturnValueOnce(qb({ id: 'org-1', name: 'Test Org' }))
        .mockReturnValueOnce(claimQb)
        .mockReturnValueOnce(memberQb)
        .mockReturnValueOnce(qb({ id: 'group-1' }))
        .mockReturnValue(qb(null));

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(true);
      // Only an unaccepted (or legacy NULL) token can be claimed: `IS NOT TRUE`
      // is null-safe, unlike `.eq('is_accepted', false)`.
      expect(claimQb.update).toHaveBeenCalledWith({ is_accepted: true });
      expect(claimQb.eq).toHaveBeenCalledWith('token', 'tok');
      expect(claimQb.not).toHaveBeenCalledWith('is_accepted', 'is', true);
      expect(claimQb.select).toHaveBeenCalledWith('id');
      expect(claimQb.maybeSingle).toHaveBeenCalled();

      // Claim (call 4) precedes the org_members upsert (call 5), and the claim is
      // the single write that consumes the token — no trailing update.
      const tables = admin.from.mock.calls.map(([table]) => table);
      expect(tables).toEqual([
        'invitations',
        'org_members',
        'organizations',
        'invitations',
        'org_members',
        'groups',
        'group_members',
      ]);
      expect(memberQb.update).not.toHaveBeenCalled();
    });

    // #317: the pasted link must normalise identically for the lookup and the
    // single-use claim, otherwise a valid link previews but fails to join (410).
    it('normalises a pasted invite link for the lookup and the claim', async () => {
      const code = 'c8a0b04e7082116c09a28ce717f83d5f';
      const admin = adminClient();
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );
      const lookupQb = qb(invitation);
      const claimQb = qb({ id: 'inv-1' });
      admin.from
        .mockReturnValueOnce(lookupQb)
        .mockReturnValueOnce(countQb(2))
        .mockReturnValueOnce(qb({ id: 'org-1', name: 'Test Org' }))
        .mockReturnValueOnce(claimQb)
        .mockReturnValueOnce(qb(null))
        .mockReturnValueOnce(qb({ id: 'group-1' }))
        .mockReturnValue(qb(null));

      const result = await service.acceptInvitation(
        joiningCtx,
        `http://localhost:3012/join?token=${code.toUpperCase()}`,
      );

      expect(result.success).toBe(true);
      expect(lookupQb.eq).toHaveBeenCalledWith('token', code);
      expect(claimQb.eq).toHaveBeenCalledWith('token', code);
    });

    it('returns NOT_FOUND without touching the DB for a link with no token', async () => {
      const admin = adminClient();
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );

      const result = await service.acceptInvitation(joiningCtx, 'https://example.com/x');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      expect(admin.from).not.toHaveBeenCalled();
    });

    it('rejects the accept when the token was already claimed concurrently (GONE)', async () => {
      const admin = adminClient();
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );
      // `.maybeSingle()` yields null when the conditional PATCH matched no row.
      const memberQb = qb({ organization_id: 'org-1' });
      admin.from
        .mockReturnValueOnce(qb(invitation))
        .mockReturnValueOnce(countQb(2))
        .mockReturnValueOnce(qb({ id: 'org-1', name: 'Test Org' }))
        .mockReturnValueOnce(qb(null)) // claim lost
        .mockReturnValue(memberQb);

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(false);
      expect(result.error).toBe('GONE');
      // Nothing was written: no org_members / group_members upsert.
      expect(admin.from).toHaveBeenCalledTimes(4);
      expect(memberQb.upsert).not.toHaveBeenCalled();
    });

    it('reports a DB failure when the claim itself fails', async () => {
      const admin = adminClient();
      service = new InvitationService(
        async () => mock as any,
        () => admin.client,
      );
      const memberQb = qb({ organization_id: 'org-1' });
      admin.from
        .mockReturnValueOnce(qb(invitation))
        .mockReturnValueOnce(countQb(2))
        .mockReturnValueOnce(qb({ id: 'org-1', name: 'Test Org' }))
        .mockReturnValueOnce(qb(null, { message: 'boom', code: 'XX000' }))
        .mockReturnValue(memberQb);

      const result = await service.acceptInvitation(joiningCtx, 'tok');

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
      expect(admin.from).toHaveBeenCalledTimes(4);
      expect(memberQb.upsert).not.toHaveBeenCalled();
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
