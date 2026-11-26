/**
 * #1032: when the SMTP server cannot be reached the invitation still exists and
 * the API still returns its copyable link (#313).
 */
import { createServer } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInbox, mailSinkFromEnv } from '#test/helpers/mailpit-inbox';
import {
  captureConsole,
  type CreatedInvite,
  expectNothingSensitiveLogged,
  invitationRows,
  inviteBulk,
  inviteOne,
  type InviteWorld,
  removeInviteWorld,
  seedInviteWorld,
  useSmtpMailer,
} from '#test/integration/invitation-mail.setup';

const sink = mailSinkFromEnv();

/** A port that was just free and has no listener, so a connection is refused. */
function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('no port was assigned'));
      });
    });
  });
}

describe.skipIf(!sink)('invitations with an unreachable SMTP server (#1032)', () => {
  const inbox = createInbox(sink?.httpUrl ?? '');
  let world!: InviteWorld;
  let logs!: ReturnType<typeof captureConsole>;

  beforeAll(async () => {
    useSmtpMailer(await closedPort());
    world = await seedInviteWorld();
  });

  beforeEach(() => {
    logs = captureConsole();
  });

  afterEach(() => {
    logs.restore();
  });

  afterAll(async () => {
    const leftover = await inbox.cleanup();
    await removeInviteWorld(world);
    vi.unstubAllEnvs();
    expect(leftover, 'messages left in Mailpit').toBe(0);
  });

  /** Row and link survive, and the send was really attempted and failed once per row. */
  async function expectKeptAndReported(emails: string[], invites: CreatedInvite[]) {
    const rows = await invitationRows(world, emails);
    expect(rows.length).toBe(invites.length);
    for (const invite of invites) {
      expect(
        rows.some((row) => row.token === invite.inviteCode),
        'the row of the returned code exists',
      ).toBe(true);
      expect(
        invite.inviteLink.endsWith(`/join?token=${invite.inviteCode}`),
        'the copyable link is returned',
      ).toBe(true);
    }

    expect(logs.count('"errorCode":"ESOCKET"')).toBe(invites.length);
    expect(logs.count('invitation.mail_sent')).toBe(0);
    for (const email of emails) {
      expect((await inbox.messagesTo(email)).length).toBe(0);
    }
    expectNothingSensitiveLogged(logs, emails, invites);
  }

  it('keeps a single invitation and returns its link', async () => {
    const email = inbox.address('down-single');

    const invite = await inviteOne(world, { email });

    // Without this the suite would also pass with mail switched off.
    expect(logs.count('invitation.mail_failed')).toBe(1);
    await expectKeptAndReported([email], [invite]);
  });

  it('keeps every invitation of a batch and returns every link', async () => {
    const emails = [inbox.address('down-bulk-a'), inbox.address('down-bulk-b')];

    const invites = await inviteBulk(
      world,
      emails.map((email) => ({ email })),
    );

    expect(logs.count('invitation.mail_failed')).toBe(emails.length);
    await expectKeptAndReported(emails, invites);
  });
});
