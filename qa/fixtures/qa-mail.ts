import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read the QA mailbox (Mailpit).
 *
 * A spec that needs an e-mail (activation, reset) must not care which stack it
 * runs against. Local `supabase stack` projects get random ports, so prefer the
 * advertised `MAILPIT_URL` (from the app env / `qa/env.json` / process env);
 * fall back to the classic "API port + 3" layout used by the shared QA stack
 * and by CI's non-stack `supabase start`.
 *
 * Only reads: a spec looks up the message addressed to **its own** unique address
 * and never lists, deletes or mutates another worker's mail.
 */

/** Non-stack Supabase CLI places Mailpit three ports above the API port. */
const MAIL_PORT_OFFSET = 3;

interface QaEnvFile {
  supabaseUrl?: string;
  mailpitUrl?: string;
}

function supabaseUrlFromProject(): string | undefined {
  const root = process.cwd();

  const envJson = join(root, 'qa', 'env.json');
  if (existsSync(envJson)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- qa/env.json is local test config; optional fields are checked below
      const parsed = JSON.parse(readFileSync(envJson, 'utf8')) as QaEnvFile;
      if (parsed.supabaseUrl) return parsed.supabaseUrl;
    } catch {
      // A malformed qa/env.json must not hide the mail catcher.
    }
  }

  const dotenv = join(root, 'apps', 'web', '.env');
  if (existsSync(dotenv)) {
    for (const line of readFileSync(dotenv, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
        return trimmed.slice('NEXT_PUBLIC_SUPABASE_URL='.length).trim();
      }
    }
  }

  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function mailpitUrlFromProject(): string | undefined {
  const root = process.cwd();

  const envJson = join(root, 'qa', 'env.json');
  if (existsSync(envJson)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- qa/env.json is local test config; optional fields are checked below
      const parsed = JSON.parse(readFileSync(envJson, 'utf8')) as QaEnvFile;
      if (parsed.mailpitUrl) return parsed.mailpitUrl;
    } catch {
      // Ignore; try the app env next.
    }
  }

  const dotenv = join(root, 'apps', 'web', '.env');
  if (existsSync(dotenv)) {
    for (const line of readFileSync(dotenv, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('MAILPIT_URL=')) {
        return trimmed.slice('MAILPIT_URL='.length).trim();
      }
    }
  }

  return process.env.MAILPIT_URL;
}

function mailUrlFor(supabaseUrl: string | undefined): string | undefined {
  if (!supabaseUrl) return undefined;
  try {
    const url = new URL(supabaseUrl);
    url.port = String(Number(url.port) + MAIL_PORT_OFFSET);
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Explicit override > advertised Mailpit URL > API+3 (non-stack) > defaults. */
function candidates(): string[] {
  return [
    process.env.QA_MAIL_URL,
    process.env.MAILPIT_URL,
    mailpitUrlFromProject(),
    mailUrlFor(process.env.NEXT_PUBLIC_SUPABASE_URL),
    mailUrlFor(supabaseUrlFromProject()),
    'http://localhost:54424',
    'http://localhost:54324',
  ].filter((value): value is string => Boolean(value));
}

interface MailMessage {
  id: string;
  html: string;
}

let resolvedBase: Promise<string> | undefined;

async function mailBase(): Promise<string> {
  resolvedBase ??= (async () => {
    for (const base of candidates()) {
      try {
        const res = await fetch(`${base}/api/v1/info`, { signal: AbortSignal.timeout(2_000) });
        // Any answer proves the catcher is there; Mailpit is 200, Inbucket 404s.
        if (res.status < 500) return base;
      } catch {
        // Connection refused — try the next candidate.
      }
    }
    throw new Error(`no mail catcher answered on ${candidates().join(', ')}`);
  })();
  return resolvedBase;
}

async function messagesFor(base: string, email: string): Promise<MailMessage[]> {
  const mailpit = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (mailpit.ok) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Mailpit is an external test fixture; every field is checked below
    const body = (await mailpit.json()) as {
      messages?: Array<{ ID: string; To?: Array<{ Address: string }> }>;
    };
    const mine = (body.messages ?? []).filter((message) =>
      (message.To ?? []).some((to) => to.Address.toLowerCase() === email.toLowerCase()),
    );
    const detailed = await Promise.all(
      mine.map(async (message) => {
        const res = await fetch(`${base}/api/v1/message/${message.ID}`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) return null;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Mailpit message payload; only HTML/Text are read
        const detail = (await res.json()) as { HTML?: string; Text?: string };
        return { id: message.ID, html: detail.HTML ?? detail.Text ?? '' };
      }),
    );
    return detailed.filter((message): message is MailMessage => message !== null);
  }

  // Classic Inbucket: one mailbox per address, messages under it.
  const mailboxName = email.split('@')[0];
  const mailbox = await fetch(`${base}/api/v1/mailbox/${encodeURIComponent(mailboxName)}`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!mailbox.ok) return [];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- legacy Inbucket mailbox listing; only ids are read
  const listed = (await mailbox.json()) as Array<{ id: string }>;
  const detailed = await Promise.all(
    listed.map(async (message) => {
      const res = await fetch(
        `${base}/api/v1/mailbox/${encodeURIComponent(mailboxName)}/${message.id}`,
        {
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!res.ok) return null;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- legacy Inbucket message payload; only the body is read
      const detail = (await res.json()) as { body?: { html?: string; text?: string } };
      return { id: message.id, html: detail.body?.html ?? detail.body?.text ?? '' };
    }),
  );
  return detailed.filter((message): message is MailMessage => message !== null);
}

/** A matched link plus how many messages the address had when it was found. */
export interface MailLinkMatch {
  link: string;
  /** Messages delivered to this address — a fresh sign-up must have exactly one. */
  messageCount: number;
}

/**
 * Wait for the first message to `email` whose body matches `pattern` and return
 * the match together with the number of messages delivered to that address.
 * Polls the catcher, because SMTP delivery is asynchronous.
 */
export async function waitForMailLinkMatch(
  email: string,
  pattern: RegExp,
  timeoutMs = 30_000,
): Promise<MailLinkMatch> {
  const base = await mailBase();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const messages = await messagesFor(base, email);
    for (const message of messages) {
      const match = pattern.exec(message.html.replace(/&amp;/g, '&'));
      if (match) return { link: match[0], messageCount: messages.length };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`no e-mail matching ${pattern} for ${email} within ${timeoutMs}ms`);
}

/**
 * Wait for the first message to `email` whose body matches `pattern` and return
 * the match. Polls the catcher, because SMTP delivery is asynchronous.
 */
export async function waitForMailLink(
  email: string,
  pattern: RegExp,
  timeoutMs = 30_000,
): Promise<string> {
  return (await waitForMailLinkMatch(email, pattern, timeoutMs)).link;
}

export interface DefaultAuthPath {
  /** App callback path rebuilt from the default auth link. */
  path: string;
  tokenHash: string;
  type: string;
  messageCount: number;
}

/**
 * TEMPORARY non-branded-email helper for the `*-temp.spec.ts` variants.
 *
 * Stack projects (native or Docker) cannot serve auth `content_path` templates,
 * so GoTrue sends its default link:
 *
 *   {API_URL}/auth/v1/verify?token=<token_hash>&type=<type>&redirect_to=<site>
 *
 * The app's `/auth/callback` still expects `token_hash`/`type`/`next`, so this
 * reconstructs that path from the default link. Remove this helper (and the
 * temp specs) once stack mode serves the branded templates.
 */
export async function waitForDefaultAuthPath(
  email: string,
  expectedType: string | undefined,
  next: string,
  timeoutMs = 60_000,
): Promise<DefaultAuthPath> {
  const mail = await waitForMailLinkMatch(
    email,
    /https?:\/\/[^"'\s]+\/auth\/v1\/verify\?[^"'\s]+/,
    timeoutMs,
  );
  const link = new URL(mail.link);
  const tokenHash = link.searchParams.get('token');
  const type = link.searchParams.get('type') ?? expectedType;

  if (!tokenHash) {
    throw new Error(`default auth link has no token: ${mail.link}`);
  }
  if (!type) {
    throw new Error(`default auth link has no type: ${mail.link}`);
  }
  if (expectedType !== undefined && type !== expectedType) {
    throw new Error(`default auth link type ${type}, expected ${expectedType}: ${mail.link}`);
  }

  return {
    path: `/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}&next=${next}`,
    tokenHash,
    type,
    messageCount: mail.messageCount,
  };
}
