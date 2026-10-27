import * as supabaseModule from '@studiq/server/lib/supabase/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  useRealSupabase,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { GET as callbackGet } from '@/app/(backend)/api/v1/auth/callback/route';
import { POST as registerPost } from '@/app/(backend)/api/v1/auth/register/route';
import { GET as orgsGet } from '@/app/(backend)/api/v1/me/orgs/route';
import { POST as invitePost } from '@/app/(backend)/api/v1/organization/invites/route';

const suiteId = crypto.randomUUID().slice(0, 8);

// #311 / ONB-08: registering from /join?token=… must end with the new user as a
// member of the inviting organization (with the invited role) once the e-mail is
// verified — not a standalone account with a permanently pending invitation.
describe(`Invite-link registration`, () => {
  const createdOrgIds: string[] = [];

  let fixture!: BeforeResult;
  let orgId!: string;
  let memberRoleId!: string;

  beforeAll(async () => {
    fixture = await before({ role: 'manager', org: true });
    orgId = fixture.orgId!;
    createdOrgIds.push(orgId);

    const supabase = createServiceClient();
    const { data: memberRole } = await supabase
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'member')
      .single();
    memberRoleId = memberRole!.id;
  });

  afterAll(async () => {
    const supabase = createServiceClient();
    for (const id of createdOrgIds) {
      await cleanupOrganizationDeep(id);
    }

    // Registration creates real auth users; drop the ones this file created.
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id')
      .like('email', `invite-register-${suiteId}-%`);
    for (const profile of profiles ?? []) {
      await supabase.auth.admin.deleteUser(profile.id);
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  function uniqueEmail(label: string) {
    return `invite-register-${suiteId}-${label}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2, 8)}@example.com`;
  }

  /** Manager creates an invitation through the real API; returns its token. */
  async function invite(email: string): Promise<string> {
    mockUser(fixture.user);
    const inviteRes = await invitePost(
      createNextRequest(
        'http://localhost/api/v1/organization/invites',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, targetOrgRoleId: memberRoleId }),
        },
        { active_org_id: orgId },
      ),
    );
    expect(inviteRes.status).toBe(201);

    const supabase = createServiceClient();
    const { data: invitation } = await supabase
      .from('invitations')
      .select('token')
      .eq('email', email)
      .eq('organization_id', orgId)
      .single();
    expect(invitation).toBeTruthy();
    return invitation!.token;
  }

  function register(body: Record<string, unknown>) {
    return registerPost(
      createNextRequest('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  /** Make the activation callback verify an already-created user. */
  function mockActivation(user: { id: string; user_metadata: Record<string, unknown> }) {
    vi.mocked(supabaseModule.createClient).mockImplementation(async () => {
      const client = createServiceClient();
      client.auth.verifyOtp = (async () => ({
        data: { user, session: null },
        error: null,
      })) as never;
      return client as never;
    });
  }

  async function profileByEmail(email: string) {
    const supabase = createServiceClient();
    const { data } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
    return data;
  }

  it('adds the invitee to the organization after activation', async () => {
    const email = uniqueEmail('happy');
    const token = await invite(email);

    const registerRes = await register({
      name: 'Invitee One',
      email,
      password: 'TestPass123',
      accountType: 'student',
      inviteToken: token,
    });
    expect(registerRes.status).toBe(202);

    // The token rides along in user_metadata until the address is proven.
    const profile = await profileByEmail(email);
    expect(profile).toBeTruthy();
    const supabase = createServiceClient();
    const { data: authUser } = await supabase.auth.admin.getUserById(profile!.id);
    expect(authUser.user?.user_metadata.invite_token).toBe(token);

    const { data: membershipBefore } = await supabase
      .from('org_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('user_id', profile!.id)
      .maybeSingle();
    expect(membershipBefore).toBeNull();

    // Activation: /auth/callback verifies the OTP, then claims the invitation.
    mockActivation(authUser.user!);
    const callbackRes = await callbackGet(
      createNextRequest(
        'http://localhost/api/v1/auth/callback?token_hash=fake&type=signup&next=/login',
      ),
    );

    expect(callbackRes.status).toBe(307);
    expect(callbackRes.headers.get('location')).toBe('http://localhost/login');
    expect(callbackRes.headers.get('set-cookie')).toContain(`active_org_id=${orgId}`);
    expect(callbackRes.headers.get('x-trace-id')).toMatch(/^[0-9a-f]{32}$/);

    const { data: accepted } = await supabase
      .from('invitations')
      .select('is_accepted')
      .eq('token', token)
      .single();
    expect(accepted?.is_accepted).toBe(true);

    const { data: membership } = await supabase
      .from('org_members')
      .select('org_role_id')
      .eq('organization_id', orgId)
      .eq('user_id', profile!.id)
      .maybeSingle();
    expect(membership?.org_role_id).toBe(memberRoleId);

    const { data: groupMember } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('group_id', fixture.defaultGroupId!)
      .eq('user_id', profile!.id)
      .maybeSingle();
    expect(groupMember).toBeTruthy();

    // ONB-08 acceptance signal: /me/orgs lists the inviting organization.
    mockUser({ id: profile!.id, role: 'student' });
    const orgsRes = await orgsGet(createNextRequest('http://localhost/api/v1/me/orgs'));
    const orgsBody = await orgsRes.json();
    expect(orgsRes.status).toBe(200);
    const joined = (orgsBody.data as Array<{ id: string; orgRoleName: string }>).find(
      (org) => org.id === orgId,
    );
    expect(joined?.orgRoleName).toBe('member');
  });

  it('rejects a token issued to a different address and creates no account', async () => {
    const invitedEmail = uniqueEmail('foreign-token');
    const attemptedEmail = uniqueEmail('foreign-attempt');
    const token = await invite(invitedEmail);

    const registerRes = await register({
      name: 'Invitee Two',
      email: attemptedEmail,
      password: 'TestPass123',
      accountType: 'student',
      inviteToken: token,
    });
    const body = await registerRes.json();

    expect(registerRes.status).toBe(400);
    expect(body.error).toBe('BAD_REQUEST');
    expect(await profileByEmail(attemptedEmail)).toBeNull();

    // The invitation is untouched and still pending for its real address.
    const supabase = createServiceClient();
    const { data: invitation } = await supabase
      .from('invitations')
      .select('is_accepted')
      .eq('token', token)
      .single();
    expect(invitation?.is_accepted).toBe(false);
  });

  it('rejects an expired token and creates no account', async () => {
    const email = uniqueEmail('expired');
    const supabase = createServiceClient();
    const token = `expired-${suiteId}-${Date.now()}`;
    const { error } = await supabase.from('invitations').insert({
      email,
      target_org_role_id: memberRoleId,
      token,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      inviter_id: fixture.user.id,
      organization_id: orgId,
    });
    if (error) throw new Error(`Failed to insert invitation: ${error.message}`);

    const registerRes = await register({
      name: 'Invitee Three',
      email,
      password: 'TestPass123',
      accountType: 'student',
      inviteToken: token,
    });
    const body = await registerRes.json();

    expect(registerRes.status).toBe(410);
    expect(body.error).toBe('GONE');
    expect(await profileByEmail(email)).toBeNull();
  });

  it('rejects an already used token and creates no account', async () => {
    const email = uniqueEmail('used');
    const token = await invite(email);

    const supabase = createServiceClient();
    await supabase.from('invitations').update({ is_accepted: true }).eq('token', token);

    const registerRes = await register({
      name: 'Invitee Four',
      email,
      password: 'TestPass123',
      accountType: 'student',
      inviteToken: token,
    });
    const body = await registerRes.json();

    expect(registerRes.status).toBe(410);
    expect(body.error).toBe('GONE');
    expect(await profileByEmail(email)).toBeNull();
  });

  it('still activates the account when the organization is full', async () => {
    // Launch plan caps max_students at 5; manager + 4 members fills it.
    const full = await before({ role: 'manager', org: true, members: { count: 4 } });
    const fullOrgId = full.orgId!;
    createdOrgIds.push(fullOrgId);

    const supabase = createServiceClient();
    const { data: fullMemberRole } = await supabase
      .from('org_roles')
      .select('id')
      .eq('organization_id', fullOrgId)
      .eq('name', 'member')
      .single();

    const email = uniqueEmail('full-org');
    mockUser(full.user);
    const inviteRes = await invitePost(
      createNextRequest(
        'http://localhost/api/v1/organization/invites',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, targetOrgRoleId: fullMemberRole!.id }),
        },
        { active_org_id: fullOrgId },
      ),
    );
    expect(inviteRes.status).toBe(201);

    const { data: invitation } = await supabase
      .from('invitations')
      .select('token')
      .eq('email', email)
      .eq('organization_id', fullOrgId)
      .single();

    const registerRes = await register({
      name: 'Invitee Five',
      email,
      password: 'TestPass123',
      accountType: 'student',
      inviteToken: invitation!.token,
    });
    // Registration always succeeds: a full org must never block sign-up.
    expect(registerRes.status).toBe(202);

    const profile = await profileByEmail(email);
    expect(profile).toBeTruthy();
    const { data: authUser } = await supabase.auth.admin.getUserById(profile!.id);

    mockActivation(authUser.user!);
    const callbackRes = await callbackGet(
      createNextRequest(
        'http://localhost/api/v1/auth/callback?token_hash=fake&type=signup&next=/login',
      ),
    );

    // Activation still redirects (login is not blocked), just without an org.
    expect(callbackRes.status).toBe(307);
    expect(callbackRes.headers.get('set-cookie')).toBeNull();
    expect(callbackRes.headers.get('x-trace-id')).toMatch(/^[0-9a-f]{32}$/);

    const { data: accepted } = await supabase
      .from('invitations')
      .select('is_accepted')
      .eq('token', invitation!.token)
      .single();
    expect(accepted?.is_accepted).toBe(false);

    const { data: membership } = await supabase
      .from('org_members')
      .select('user_id')
      .eq('organization_id', fullOrgId)
      .eq('user_id', profile!.id)
      .maybeSingle();
    expect(membership).toBeNull();
  });
});
