import { LogMailer } from '@studiq/server/lib/mailer/log-mailer';
import type { Mailer } from '@studiq/server/lib/mailer/mailer';
import { SmtpMailer } from '@studiq/server/lib/mailer/smtp-mailer';

export class MailConfigError extends Error {
  constructor(message: string) {
    super(`Invalid mail configuration: ${message}`);
    this.name = 'MailConfigError';
  }
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new MailConfigError(`${name} is required for MAIL_DRIVER=smtp`);
  return value;
}

/**
 * Picks the mail adapter from environment variables:
 *
 * - `MAIL_DRIVER` unset or `none`: no mail is sent (the copyable invite link stays the
 *   delivery path). This is the default, so nothing changes until an operator opts in.
 * - `MAIL_DRIVER=log`: print messages to the log (NODE_ENV=development only).
 * - `MAIL_DRIVER=smtp`: `MAIL_FROM`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT` required;
 *   `MAIL_SMTP_SECURE=true` for implicit TLS; `MAIL_SMTP_USER` + `MAIL_SMTP_PASS` together.
 *
 * Anything else throws a `MailConfigError`, so a typo fails at boot instead of silently
 * sending nothing. Credentials come from the runtime environment only.
 */
export function createMailerFromEnv(env: Env = process.env): Mailer | null {
  const driver = (env.MAIL_DRIVER ?? 'none').trim().toLowerCase();

  if (driver === '' || driver === 'none') return null;

  if (driver === 'log') {
    // Fail closed: the log adapter writes recipients and invitation links (a bearer capability) to
    // the log store, so only an explicit development run may use it, never staging or preview.
    if (env.NODE_ENV !== 'development') {
      throw new MailConfigError(
        'MAIL_DRIVER=log prints invitation links and is only allowed when NODE_ENV=development',
      );
    }
    return new LogMailer();
  }

  if (driver === 'smtp') {
    const host = required(env, 'MAIL_SMTP_HOST');
    const from = required(env, 'MAIL_FROM');
    const portText = required(env, 'MAIL_SMTP_PORT');
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new MailConfigError(`MAIL_SMTP_PORT must be a port number, got "${portText}"`);
    }

    const user = env.MAIL_SMTP_USER?.trim();
    const pass = env.MAIL_SMTP_PASS;
    if (Boolean(user) !== Boolean(pass)) {
      throw new MailConfigError('MAIL_SMTP_USER and MAIL_SMTP_PASS must be set together');
    }

    return new SmtpMailer({
      host,
      port,
      secure: env.MAIL_SMTP_SECURE?.trim().toLowerCase() === 'true',
      from,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  throw new MailConfigError(`unknown MAIL_DRIVER "${driver}" (expected none, log or smtp)`);
}

let cached: { mailer: Mailer | null } | undefined;

/** Process-wide mailer built from `process.env` on first use. */
export function getMailer(): Mailer | null {
  if (!cached) cached = { mailer: createMailerFromEnv() };
  return cached.mailer;
}
