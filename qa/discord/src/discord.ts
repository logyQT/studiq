import { Client, Events, GatewayIntentBits } from 'discord.js';
import type { Logger } from './log';

export function createClient(label: string, log: Logger): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on('error', (err) => log.error(label, `client error: ${err.message}`));
  client.on('warn', (msg) => log.warn(label, msg));
  client.on('shardError', (err) => log.error(label, `shard error: ${err.message}`));
  client.on('invalidated', () => log.error(label, 'session invalidated — reconnect required'));

  return client;
}

export async function login(
  client: Client,
  token: string,
  label: string,
  log: Logger,
  timeoutMs = 30_000,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('login timed out')), timeoutMs);
    client.once(Events.ClientReady, () => {
      clearTimeout(timer);
      resolve();
    });
    client.login(token).catch((err: unknown) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
  log.info(label, `online as ${client.user?.tag ?? 'unknown'}`);
}

export function isOwnerMessage(
  authorId: string,
  bot: boolean,
  ownerIds: readonly string[],
): boolean {
  return !bot && ownerIds.includes(authorId);
}
