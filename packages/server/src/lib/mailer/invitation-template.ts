import type { InvitationMail, MailLocale } from '@studiq/server/lib/mailer/mailer';

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

interface Copy {
  subject: (orgName: string) => string;
  greeting: string;
  invitedBy: (inviterName: string, orgName: string) => string;
  invited: (orgName: string) => string;
  cta: string;
  expires: (date: string) => string;
  linkHint: string;
  ignore: string;
}

const COPY: Record<MailLocale, Copy> = {
  pl: {
    subject: (orgName) => `Zaproszenie do ${orgName} w StudiQ`,
    greeting: 'Cześć!',
    invitedBy: (inviterName, orgName) =>
      `${inviterName} zaprasza Cię do organizacji ${orgName} w StudiQ.`,
    invited: (orgName) => `Zaproszono Cię do organizacji ${orgName} w StudiQ.`,
    cta: 'Dołącz do organizacji',
    expires: (date) => `Zaproszenie jest ważne do ${date}.`,
    linkHint: 'Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:',
    ignore: 'Jeśli to zaproszenie nie jest do Ciebie, po prostu zignoruj tę wiadomość.',
  },
  en: {
    subject: (orgName) => `You are invited to ${orgName} on StudiQ`,
    greeting: 'Hello!',
    invitedBy: (inviterName, orgName) => `${inviterName} invites you to join ${orgName} on StudiQ.`,
    invited: (orgName) => `You have been invited to join ${orgName} on StudiQ.`,
    cta: 'Join the organization',
    expires: (date) => `This invitation is valid until ${date}.`,
    linkHint: 'If the button does not work, copy this link into your browser:',
    ignore: 'If this invitation is not meant for you, just ignore this message.',
  },
};

const INTL_LOCALE: Record<MailLocale, string> = { pl: 'pl-PL', en: 'en-GB' };

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Single-line, so a name or org name can never inject a header or a new paragraph. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * PL / EN invitation message. The join URL is used verbatim and appears twice
 * (button + plain link) so it survives clients that strip buttons; the expiry
 * date is part of the body so an invitee knows how long it is good for.
 */
export function renderInvitationMail(mail: InvitationMail): RenderedMail {
  const copy = COPY[mail.locale];
  const orgName = oneLine(mail.orgName);
  const inviterName = mail.inviterName ? oneLine(mail.inviterName) : '';
  const intro = inviterName ? copy.invitedBy(inviterName, orgName) : copy.invited(orgName);
  const expires = copy.expires(
    new Intl.DateTimeFormat(INTL_LOCALE[mail.locale], {
      dateStyle: 'long',
      timeZone: 'Europe/Warsaw',
    }).format(mail.expiresAt),
  );

  const text = [
    copy.greeting,
    '',
    intro,
    '',
    `${copy.cta}: ${mail.joinUrl}`,
    '',
    expires,
    copy.ignore,
  ].join('\n');

  const url = escapeHtml(mail.joinUrl);
  const html = [
    '<!doctype html>',
    `<html lang="${mail.locale}"><body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5">`,
    `<p>${copy.greeting}</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">${escapeHtml(copy.cta)}</a></p>`,
    `<p>${escapeHtml(copy.linkHint)}<br><a href="${url}">${url}</a></p>`,
    `<p>${escapeHtml(expires)}</p>`,
    `<p style="color:#555">${escapeHtml(copy.ignore)}</p>`,
    '</body></html>',
  ].join('');

  return { subject: copy.subject(orgName), text, html };
}
