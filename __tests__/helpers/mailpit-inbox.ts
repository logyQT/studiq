import { isCi } from '#test/helpers/qa-pointer';

/**
 * Mailpit access for integration tests that send real mail.
 *
 * Unlike `#test/helpers/mailpit` (the QA mailbox reader) this has no default or
 * derived URLs: a guessed address can be another checkout's catcher. It also
 * deletes, but only messages addressed to recipients the test created itself.
 *
 * No error here carries an address or a message: these end up in CI logs.
 */
export interface MailSink {
  httpUrl: string;
  smtpPort: number;
}

/**
 * The configured sink, or `null` when a developer's run has none and the mail
 * suites should be skipped. In CI a missing value throws instead: a skipped
 * suite would report green without having sent anything.
 */
export function mailSinkFromEnv(env: NodeJS.ProcessEnv = process.env): MailSink | null {
  const httpUrl = env.MAILPIT_URL;
  const smtpPort = Number(env.MAILPIT_SMTP_PORT);
  if (httpUrl && Number.isInteger(smtpPort) && smtpPort > 0) return { httpUrl, smtpPort };
  if (isCi(env)) {
    throw new Error('CI must export MAILPIT_URL and MAILPIT_SMTP_PORT for the mail suites');
  }
  return null;
}

export interface InboxMessage {
  id: string;
  subject: string;
  text: string;
  html: string;
}

interface SearchResult {
  messages: Array<{ ID: string; To: Array<{ Address: string }> | null }>;
}

interface MessageDetail {
  Subject: string;
  Text: string;
  HTML: string;
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Mailpit answered ${response.status}`);
  return response;
}

export function createInbox(httpUrl: string) {
  const recipients: string[] = [];

  async function idsFor(address: string): Promise<string[]> {
    const query = encodeURIComponent(`to:"${address}"`);
    const response = await request(`${httpUrl}/api/v1/search?query=${query}&limit=200`);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Mailpit's search payload; only these fields are read
    const { messages } = (await response.json()) as SearchResult;
    return messages
      .filter((message) => message.To?.some((to) => to.Address.toLowerCase() === address))
      .map((message) => message.ID);
  }

  return {
    /** A new unique recipient, remembered so `cleanup` can find its mail. */
    address(label: string): string {
      const address = `mail-${label}-${crypto.randomUUID()}@example.com`;
      recipients.push(address);
      return address;
    },

    /** Everything delivered to `address`; the caller asserts how many that is. */
    async messagesTo(address: string): Promise<InboxMessage[]> {
      const ids = await idsFor(address);
      return Promise.all(
        ids.map(async (id) => {
          const response = await request(`${httpUrl}/api/v1/message/${id}`);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Mailpit's message payload; only these fields are read
          const detail = (await response.json()) as MessageDetail;
          return { id, subject: detail.Subject, text: detail.Text, html: detail.HTML };
        }),
      );
    },

    /** Deletes the mail of this inbox's recipients; returns how much was left afterwards. */
    async cleanup(): Promise<number> {
      const ids = (await Promise.all(recipients.map(idsFor))).flat();
      // Mailpit reads an empty ID list as "delete everything".
      if (ids.length > 0) {
        await request(`${httpUrl}/api/v1/messages`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ IDs: ids }),
        });
      }
      return (await Promise.all(recipients.map(idsFor))).flat().length;
    },
  };
}
