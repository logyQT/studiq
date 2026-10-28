import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInvitationMail } from '@studiq/server/lib/mailer/invitation-template';
import { createMailerFromEnv, MailConfigError } from '@studiq/server/lib/mailer';
import { LogMailer } from '@studiq/server/lib/mailer/log-mailer';
import type { InvitationMail } from '@studiq/server/lib/mailer/mailer';
import { SmtpMailer } from '@studiq/server/lib/mailer/smtp-mailer';

const sendMail = vi.fn();
const close = vi.fn();
const createTransport = vi.fn(() => ({ sendMail, close }));
vi.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransport(...(args as [])),
}));

const mail: InvitationMail = {
  to: 'ola@example.com',
  orgName: 'WSB Merito',
  inviterName: 'Jan Kowalski',
  joinUrl: 'https://studiq.example/join?token=0123456789abcdef0123456789abcdef',
  expiresAt: new Date('2026-11-03T12:00:00Z'),
  locale: 'pl',
};

describe('createMailerFromEnv', () => {
  it('sends nothing by default, so the copyable link stays the delivery path', () => {
    expect(createMailerFromEnv({})).toBeNull();
    expect(createMailerFromEnv({ MAIL_DRIVER: 'none' })).toBeNull();
    expect(createMailerFromEnv({ MAIL_DRIVER: '  ' })).toBeNull();
  });

  it('selects the log adapter in a development run', () => {
    expect(createMailerFromEnv({ MAIL_DRIVER: 'log', NODE_ENV: 'development' })).toBeInstanceOf(
      LogMailer,
    );
  });

  it.each(['production', 'staging', 'preview', 'test', undefined])(
    'refuses the log adapter unless NODE_ENV is development (%s)',
    (nodeEnv) => {
      // It prints recipients and invitation links, so it fails closed everywhere else.
      expect(() => createMailerFromEnv({ MAIL_DRIVER: 'log', NODE_ENV: nodeEnv })).toThrow(
        MailConfigError,
      );
    },
  );

  it('selects the SMTP adapter when its settings are complete', () => {
    const env = {
      MAIL_DRIVER: 'smtp',
      MAIL_FROM: 'StudiQ <no-reply@studiq.example>',
      MAIL_SMTP_HOST: '127.0.0.1',
      MAIL_SMTP_PORT: '54325',
    };
    expect(createMailerFromEnv(env)).toBeInstanceOf(SmtpMailer);
    expect(
      createMailerFromEnv({ ...env, MAIL_SMTP_USER: 'apikey', MAIL_SMTP_PASS: 'secret' }),
    ).toBeInstanceOf(SmtpMailer);
  });

  it.each([
    ['host', { MAIL_FROM: 'a@b.c', MAIL_SMTP_PORT: '25' }],
    ['from', { MAIL_SMTP_HOST: 'h', MAIL_SMTP_PORT: '25' }],
    ['port', { MAIL_FROM: 'a@b.c', MAIL_SMTP_HOST: 'h' }],
    ['non-numeric port', { MAIL_FROM: 'a@b.c', MAIL_SMTP_HOST: 'h', MAIL_SMTP_PORT: 'abc' }],
    ['out-of-range port', { MAIL_FROM: 'a@b.c', MAIL_SMTP_HOST: 'h', MAIL_SMTP_PORT: '70000' }],
    [
      'user without password',
      { MAIL_FROM: 'a@b.c', MAIL_SMTP_HOST: 'h', MAIL_SMTP_PORT: '25', MAIL_SMTP_USER: 'u' },
    ],
  ])('fails fast on smtp with a missing or invalid %s', (_name, extra) => {
    expect(() => createMailerFromEnv({ MAIL_DRIVER: 'smtp', ...extra })).toThrow(MailConfigError);
  });

  it('fails fast on an unknown driver instead of silently sending nothing', () => {
    expect(() => createMailerFromEnv({ MAIL_DRIVER: 'sendgrid' })).toThrow(/unknown MAIL_DRIVER/);
  });
});

describe('renderInvitationMail', () => {
  it('renders Polish with the join URL, the org, the inviter and the expiry date', () => {
    const { subject, text, html } = renderInvitationMail(mail);
    expect(subject).toBe('Zaproszenie do WSB Merito w StudiQ');
    expect(text).toContain('Jan Kowalski zaprasza Cię do organizacji WSB Merito');
    expect(text).toContain(mail.joinUrl);
    expect(text).toContain('3 listopada 2026');
    expect(html).toContain(`href="${mail.joinUrl}"`);
    expect(html).toContain('lang="pl"');
  });

  it('renders English', () => {
    const { subject, text, html } = renderInvitationMail({ ...mail, locale: 'en' });
    expect(subject).toBe('You are invited to WSB Merito on StudiQ');
    expect(text).toContain('Jan Kowalski invites you to join WSB Merito');
    expect(text).toContain('3 November 2026');
    expect(html).toContain('lang="en"');
  });

  it('omits the inviter sentence when the inviter has no name', () => {
    const { text } = renderInvitationMail({ ...mail, inviterName: null, locale: 'en' });
    expect(text).toContain('You have been invited to join WSB Merito on StudiQ.');
    expect(text).not.toContain('null');
  });

  it('escapes HTML in names and keeps them on one line', () => {
    const { html, subject } = renderInvitationMail({
      ...mail,
      orgName: 'Evil <script>alert(1)</script>\r\nBcc: x@y.z',
      inviterName: '"><img src=x>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('uses the join URL verbatim, so it matches what the UI copies', () => {
    const joinUrl = 'https://studiq.example/join?token=abc&x=1';
    const { text, html } = renderInvitationMail({ ...mail, joinUrl });
    expect(text).toContain(joinUrl);
    expect(html).toContain('token=abc&amp;x=1');
  });
});

describe('SmtpMailer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({});
  });

  const config = {
    host: '127.0.0.1',
    port: 54325,
    secure: false,
    from: 'StudiQ <no-reply@studiq.example>',
  };

  it('hands the rendered message to the SMTP transport and closes it', async () => {
    await new SmtpMailer(config).sendInvitation(mail);

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1', port: 54325, secure: false }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: config.from,
        to: 'ola@example.com',
        subject: 'Zaproszenie do WSB Merito w StudiQ',
        text: expect.stringContaining(mail.joinUrl),
        html: expect.stringContaining(mail.joinUrl),
      }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects when the relay refuses, and still closes the transport', async () => {
    sendMail.mockRejectedValue(new Error('relay down'));
    await expect(new SmtpMailer(config).sendInvitation(mail)).rejects.toThrow('relay down');
    expect(close).toHaveBeenCalledOnce();
  });
});
