export type MailLocale = 'pl' | 'en';

export const MAIL_LOCALES: readonly MailLocale[] = ['pl', 'en'];

export interface InvitationMail {
  to: string;
  orgName: string;
  /** Null when the inviter has no profile name; the template then omits the sentence. */
  inviterName: string | null;
  /** The exact `/join?token=…` URL the „Kopiuj link” button copies. */
  joinUrl: string;
  expiresAt: Date;
  locale: MailLocale;
}

/**
 * Outbound mail port. Services depend on this interface only; the adapter
 * (SMTP, log) is picked from config in `createMailerFromEnv`, so no provider call
 * lives in a controller or a service. `sendInvitation` rejects on a delivery
 * failure; callers decide whether that matters (invitations: it never does).
 */
export interface Mailer {
  sendInvitation(mail: InvitationMail): Promise<void>;
}
