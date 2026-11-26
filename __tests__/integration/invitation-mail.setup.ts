/**
 * Shared setup of the two invitation-mail suites. They are separate files because
 * `getMailer()` caches its configuration for the life of the process, and each
 * file gets its own: one points at Mailpit, the other at a port nothing listens on.
 */
import { format } from 'node:util';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { expect, vi } from 'vitest';
import { json } from '#test/helpers/json';
import { type BeforeResult, before } from '#test/helpers/test-user';
import { cleanupInvitations, cleanupOrganizationDeep, mockUser } from '#test/integration/helpers';
import { createNextRequest, createTypedServiceClient } from '#test/integration/test-utils';
import { POST as bulkPost } from '@/app/(backend)/api/v1/organization/invites/bulk/route';
import { POST as invitePost } from '@/app/(backend)/api/v1/organization/invites/route';

export function useSmtpMailer(port: number): void {
  vi.stubEnv('MAIL_DRIVER', 'smtp');
  vi.stubEnv('MAIL_SMTP_HOST', '127.0.0.1');
  vi.stubEnv('MAIL_SMTP_PORT', String(port));
  vi.stubEnv('MAIL_SMTP_SECURE', 'false');
  vi.stubEnv('MAIL_SMTP_USER', '');
  vi.stubEnv('MAIL_SMTP_PASS', '');
  vi.stubEnv('MAIL_FROM', 'StudiQ <no-reply@studiq.test>');
}

export interface InviteWorld {
  orgName: string;
  inviterName: string;
  memberRoleId: string;
  fixture: BeforeResult;
}

/** A manager with an organization of their own, both with names the mail must carry. */
export async function seedInviteWorld(): Promise<InviteWorld> {
  const fixture = await before({ role: 'manager', org: true });
  const orgId = fixture.orgId!;
  const tag = crypto.randomUUID().slice(0, 8);
  const orgName = `Szkoła Łączności ${tag}`;
  const inviterName = `Żaneta Zapraszająca ${tag}`;
  const db = createTypedServiceClient();

  const renamedOrg = await db.from('organizations').update({ name: orgName }).eq('id', orgId);
  const renamedUser = await db
    .from('profiles')
    .update({ full_name: inviterName })
    .eq('id', fixture.user.id);
  const role = await db
    .from('org_roles')
    .select('id')
    .eq('organization_id', orgId)
    .eq('name', 'member')
    .single();
  const failure = renamedOrg.error ?? renamedUser.error ?? role.error;
  if (failure || !role.data) throw new Error(`invite fixture failed: ${failure?.message}`);

  return { orgName, inviterName, memberRoleId: role.data.id, fixture };
}

/** Accepts `undefined`, so an `afterAll` after a failed seed stays quiet. */
export async function removeInviteWorld(world: InviteWorld | undefined): Promise<void> {
  if (!world) return;
  const { fixture } = world;
  await cleanupInvitations(fixture.user.id);
  await cleanupOrganizationDeep(fixture.orgId!);
  const { error } = await createTypedServiceClient().auth.admin.deleteUser(fixture.user.id);
  if (error) throw new Error(`could not delete the fixture user: ${error.message}`);
}

export interface InviteEntry {
  email: string;
  locale?: 'pl' | 'en';
}

export interface CreatedInvite {
  inviteLink: string;
  inviteCode: string;
}

function post(world: InviteWorld, path: string, body: unknown) {
  mockUser(world.fixture.user);
  return createNextRequest(
    `http://localhost/api/v1/organization/${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { active_org_id: world.fixture.orgId! },
  );
}

/** One invitation through the real route, which answers 201. */
export async function inviteOne(world: InviteWorld, entry: InviteEntry): Promise<CreatedInvite> {
  const response = await invitePost(
    post(world, 'invites', { ...entry, targetOrgRoleId: world.memberRoleId }),
  );
  expect(response.status).toBe(201);
  return (await json<{ data: CreatedInvite }>(response)).data;
}

/** A batch through the real bulk route; results come back in the order sent. */
export async function inviteBulk(
  world: InviteWorld,
  entries: InviteEntry[],
): Promise<CreatedInvite[]> {
  const response = await bulkPost(
    post(world, 'invites/bulk', {
      invitations: entries.map((entry) => ({ ...entry, targetOrgRoleId: world.memberRoleId })),
    }),
  );
  expect(response.status).toBe(200);
  const body = await json<{ data: { results: Array<{ data: CreatedInvite }> } }>(response);
  expect(body.data.results.length).toBe(entries.length);
  return body.data.results.map((result) => result.data);
}

/** The invitation rows persisted for these addresses. */
export async function invitationRows(world: InviteWorld, emails: string[]) {
  const { data, error } = await createTypedServiceClient()
    .from('invitations')
    .select('email, token, expires_at')
    .eq('organization_id', world.fixture.orgId!)
    .in('email', emails);
  if (error) throw new Error(`could not read invitation rows: ${error.message}`);
  return dbRows(data);
}

/**
 * Everything the code under test prints. With the OTel pipeline off, `lib/log`
 * writes to the console, so this sees the service and request logs alike.
 */
export function captureConsole() {
  const lines: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(format(...args));
    }),
  );
  return {
    count: (fragment: string) => lines.filter((line) => line.includes(fragment)).length,
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}

/**
 * No address and no token in anything logged. Compared as booleans, here and in
 * the suites, so a failure cannot print the value it is about.
 */
export function expectNothingSensitiveLogged(
  logs: ReturnType<typeof captureConsole>,
  emails: string[],
  invites: CreatedInvite[],
): void {
  expect(
    emails.every((email) => logs.count(email) === 0),
    'no e-mail address in the logs',
  ).toBe(true);
  expect(
    invites.every((invite) => logs.count(invite.inviteCode) === 0),
    'no invitation token in the logs',
  ).toBe(true);
}
