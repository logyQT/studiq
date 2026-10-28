import { renderInvitationMail } from '@studiq/server/lib/mailer/invitation-template';
import type { InvitationMail, Mailer } from '@studiq/server/lib/mailer/mailer';

export interface SmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS (port 465). STARTTLS is negotiated automatically otherwise. */
  secure: boolean;
  from: string;
  auth?: { user: string; pass: string };
}

/**
 * SMTP adapter: Inbucket / Mailpit in development, any SMTP relay or SaaS SMTP
 * endpoint (Resend, SES, Postmark) in production. Short timeouts keep a dead
 * relay from holding the invitation request open.
 */
export class SmtpMailer implements Mailer {
  constructor(private config: SmtpConfig) {}

  async sendInvitation(mail: InvitationMail): Promise<void> {
    // Imported lazily: the module is only needed when this adapter is selected.
    const { createTransport } = await import('nodemailer');
    const transport = createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: this.config.auth,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    });

    const { subject, text, html } = renderInvitationMail(mail);
    try {
      await transport.sendMail({ from: this.config.from, to: mail.to, subject, text, html });
    } finally {
      transport.close();
    }
  }
}
