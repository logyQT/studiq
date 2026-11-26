/**
 * #1032: an invitation created through the real route reaches a real SMTP server
 * (Mailpit), through the real service, adapter and template. The expected wording
 * is written out here on purpose: reading it from the template would let a wrong
 * template pass.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInbox, type InboxMessage, mailSinkFromEnv } from '#test/helpers/mailpit-inbox';
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

type Locale = 'pl' | 'en';

const WORDING = {
  pl: {
    dateLocale: 'pl-PL',
    subject: (org: string) => `Zaproszenie do ${org} w StudiQ`,
    intro: (inviter: string, org: string) =>
      `${inviter} zaprasza Cię do organizacji ${org} w StudiQ.`,
    cta: 'Dołącz do organizacji',
    expires: (date: string) => `Zaproszenie jest ważne do ${date}.`,
  },
  en: {
    dateLocale: 'en-GB',
    subject: (org: string) => `You are invited to ${org} on StudiQ`,
    intro: (inviter: string, org: string) => `${inviter} invites you to join ${org} on StudiQ.`,
    cta: 'Join the organization',
    expires: (date: string) => `This invitation is valid until ${date}.`,
  },
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 23:30 UTC today is already tomorrow in Warsaw, summer and winter, so a date
 * formatted in any other zone differs from the expected one at every run.
 */
function lateEvening(): Date {
  const now = new Date();
  now.setUTCHours(23, 30, 0, 0);
  return now;
}

function longDate(date: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(WORDING[locale].dateLocale, {
    dateStyle: 'long',
    timeZone,
  }).format(date);
}

const linksIn = (text: string) => text.match(/https?:\/\/\S+\/join\?token=\w+/g) ?? [];

const hrefsIn = (html: string) =>
  [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replaceAll('&amp;', '&'));

describe.skipIf(!sink)('invitation mail reaches the SMTP server (#1032)', () => {
  const inbox = createInbox(sink?.httpUrl ?? '');
  let world!: InviteWorld;
  let logs!: ReturnType<typeof captureConsole>;

  beforeAll(async () => {
    useSmtpMailer(sink!.smtpPort);
    world = await seedInviteWorld();
  });

  beforeEach(() => {
    logs = captureConsole();
    // Only the clock is faked; SMTP and HTTP keep their real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(lateEvening());
  });

  afterEach(() => {
    vi.useRealTimers();
    logs.restore();
  });

  afterAll(async () => {
    const leftover = await inbox.cleanup();
    await removeInviteWorld(world);
    vi.unstubAllEnvs();
    expect(leftover, 'messages left in Mailpit').toBe(0);
  });

  /** One message must be exactly the invitation the API described, in `locale`. */
  async function expectInvitationMail(
    message: InboxMessage,
    email: string,
    invite: CreatedInvite,
    locale: Locale,
  ) {
    const rows = await invitationRows(world, [email]);
    const row = rows.find((candidate) => candidate.token === invite.inviteCode);
    expect(row !== undefined, 'the invitation row of this link exists').toBe(true);

    const expiresAt = new Date(row!.expires_at);
    const lifetime = expiresAt.getTime() - Date.now();
    expect(Math.abs(lifetime - 7 * DAY_MS) < 60_000, 'the invitation lasts 7 days').toBe(true);
    const date = longDate(expiresAt, locale, 'Europe/Warsaw');
    expect(date).not.toBe(longDate(expiresAt, locale, 'UTC'));

    const words = WORDING[locale];
    expect(message.subject).toBe(words.subject(world.orgName));
    for (const [part, body] of [
      ['text', message.text],
      ['HTML', message.html],
    ] as const) {
      expect(body.includes(words.intro(world.inviterName, world.orgName)), `${part} intro`).toBe(
        true,
      );
      expect(body.includes(words.cta), `${part} call to action`).toBe(true);
      expect(body.includes(words.expires(date)), `${part} expiry date`).toBe(true);
    }

    const textLinks = linksIn(message.text);
    expect(textLinks.length).toBe(1);
    expect(textLinks[0] === invite.inviteLink, 'the text carries the API link').toBe(true);

    // The button and the copy-paste fallback.
    const hrefs = hrefsIn(message.html);
    expect(hrefs.length).toBe(2);
    expect(
      hrefs.every((href) => href === invite.inviteLink),
      'both HTML links are the API link',
    ).toBe(true);
    expect(message.html.includes(`>${invite.inviteLink}</a>`), 'the HTML shows the link').toBe(
      true,
    );
  }

  it.each(['pl', 'en'] as const)('sends one %s message for one invitation', async (locale) => {
    const email = inbox.address(`single-${locale}`);

    const invite = await inviteOne(world, { email, locale });

    const messages = await inbox.messagesTo(email);
    expect(messages.length).toBe(1);
    await expectInvitationMail(messages[0]!, email, invite, locale);
    expect(logs.count('invitation.mail_sent')).toBe(1);
    expectNothingSensitiveLogged(logs, [email], [invite]);
  });

  it('sends one message per created row of a batch, each with its link and language', async () => {
    const repeated = inbox.address('bulk-repeated');
    const english = inbox.address('bulk-en');
    const polish = inbox.address('bulk-pl');
    // The repeated address gets two rows. No locale means Polish.
    const batch = [
      { entry: { email: repeated }, locale: 'pl' },
      { entry: { email: english, locale: 'en' }, locale: 'en' },
      { entry: { email: repeated, locale: 'en' }, locale: 'en' },
      { entry: { email: polish, locale: 'pl' }, locale: 'pl' },
    ] as const;

    const invites = await inviteBulk(
      world,
      batch.map(({ entry }) => entry),
    );

    const addresses = [repeated, english, polish];
    const delivered = new Map(
      await Promise.all(
        addresses.map(async (email) => [email, await inbox.messagesTo(email)] as const),
      ),
    );
    expect(addresses.map((email) => delivered.get(email)!.length)).toEqual([2, 1, 1]);
    expect(new Set(invites.map((invite) => invite.inviteCode)).size).toBe(batch.length);

    for (const [index, { entry, locale }] of batch.entries()) {
      const invite = invites[index]!;
      const carrying = delivered
        .get(entry.email)!
        .filter((message) => linksIn(message.text).includes(invite.inviteLink));
      expect(carrying.length, `messages carrying the link of row ${index}`).toBe(1);
      await expectInvitationMail(carrying[0]!, entry.email, invite, locale);
    }

    expect(logs.count('invitation.mail_sent')).toBe(batch.length);
    expectNothingSensitiveLogged(logs, addresses, invites);
  });
});
