import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read the shared stack's mail catcher — the "Inbucket" of the QA environment.
 *
 * A spec that needs an e-mail (activation, reset) must not care which catcher the
 * stack runs: the shared QA box exposes **Mailpit** (`/api/v1/search`), while a
 * `supabase start` (CI) still calls the service inbucket and may answer with the
 * classic Inbucket REST API (`/api/v1/mailbox/<name>`). Both are read here.
 *
 * Only reads: a spec looks up the message addressed to **its own** unique address
 * and never lists, deletes or mutates another worker's mail.
 */

/** Supabase CLI places inbucket three ports above the API port. */
const INBUCKET_PORT_OFFSET = 3;

interface QaEnvFile {
  supabaseUrl?: string;
}

function supabaseUrlFromProject(): string | undefined {
  const root = process.cwd();

  const envJson = join(root, 'qa', 'env.json');
  if (existsSync(envJson)) {
    try {
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

function mailUrlFor(supabaseUrl: string | undefined): string | undefined {
  if (!supabaseUrl) return undefined;
  try {
    const url = new URL(supabaseUrl);
    url.port = String(Number(url.port) + INBUCKET_PORT_OFFSET);
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Explicit override first, then the stack's API port + 3, then the defaults. */
function candidates(): string[] {
  return [
    process.env.QA_MAIL_URL,
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
      const detail = (await res.json()) as { body?: { html?: string; text?: string } };
      return { id: message.id, html: detail.body?.html ?? detail.body?.text ?? '' };
    }),
  );
  return detailed.filter((message): message is MailMessage => message !== null);
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
  const base = await mailBase();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const message of await messagesFor(base, email)) {
      const match = pattern.exec(message.html.replace(/&amp;/g, '&'));
      if (match) return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`no e-mail matching ${pattern} for ${email} within ${timeoutMs}ms`);
}
