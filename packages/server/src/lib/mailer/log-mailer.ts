import { log } from '@studiq/server/lib/log';
import { renderInvitationMail } from '@studiq/server/lib/mailer/invitation-template';
import type { InvitationMail, Mailer } from '@studiq/server/lib/mailer/mailer';

/**
 * Development adapter: prints the rendered message instead of sending it. It
 * writes the join URL (a bearer capability) to the log on purpose, so it is
 * refused in production by `createMailerFromEnv`.
 */
export class LogMailer implements Mailer {
  async sendInvitation(mail: InvitationMail): Promise<void> {
    const { subject, text } = renderInvitationMail(mail);
    log('mail.log_driver', { to: mail.to, subject, text });
  }
}
