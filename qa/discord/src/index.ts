import { existsSync, readFileSync } from 'node:fs';
import { type AttachmentBuilder, Client, Events, type Message, type TextChannel } from 'discord.js';
import { Bridge } from './bridge';
import { handleCommand } from './commands';
import { type Config, loadDotenv, readConfig } from './config';
import { createClient, isOwnerMessage, login } from './discord';
import { Logger } from './log';
import { OpencodeClient } from './opencode';
import { QaManager } from './qa';
import { StateStore } from './state';
import { StatusPublisher } from './status';

const UA = 'DiscordBot (https://github.com/discord/discord-api-docs, 1.0)';

function usage(): void {
  console.log(`Usage: bun src/index.ts [--check|--dry-run]

  --check     validate .env, tokens, channels, opencode and dashboard, then exit
  --dry-run   run the status/relay loops but post nothing to Discord
  (no flag)   run the bots`);
}

async function api(
  path: string,
  token: string,
  base = 'https://discord.com/api/v10',
): Promise<Response> {
  return fetch(base + path, {
    headers: { Authorization: `Bot ${token}`, 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
}

async function check(config: Config, log: Logger): Promise<boolean> {
  let ok = true;
  const fail = (what: string, detail: string): void => {
    ok = false;
    console.log(`  FAIL ${what}: ${detail}`);
  };
  const pass = (what: string, detail = ''): void => {
    console.log(`  ok   ${what}${detail ? `: ${detail}` : ''}`);
  };

  console.log('discord');
  const tokens: Array<[string, string]> = [['manager', config.manager.token]];
  for (const slot of config.slots) tokens.push([slot.label, slot.token]);

  for (const [label, token] of tokens) {
    try {
      const res = await api('/users/@me', token);
      if (!res.ok) {
        fail(`${label} token`, `HTTP ${res.status}`);
        continue;
      }
      const user = (await res.json()) as { username: string; discriminator?: string };
      pass(`${label} token`, `${user.username}#${user.discriminator ?? '0'}`);
    } catch (err) {
      fail(`${label} token`, err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const res = await api(`/guilds/${config.guildId}`, config.manager.token);
    if (!res.ok) fail('guild', `HTTP ${res.status}`);
    else {
      const guild = (await res.json()) as { name: string };
      pass('guild', guild.name);
    }
  } catch (err) {
    fail('guild', err instanceof Error ? err.message : String(err));
  }

  try {
    const res = await api(`/guilds/${config.guildId}/channels`, config.manager.token);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const channels = (await res.json()) as Array<{ id: string; name: string; type: number }>;
    const byId = new Map(channels.map((c) => [c.id, c]));
    const wanted: Array<[string, string]> = [
      [config.dashboardChannelId, 'dashboard'],
      [config.manager.channelId, 'manager'],
      ...config.slots.map((s) => [s.channelId, s.label] as [string, string]),
    ];
    for (const [id, label] of wanted) {
      const channel = byId.get(id);
      if (!channel) fail(`#${label}`, `id ${id} not in guild`);
      else if (channel.type !== 0) fail(`#${label}`, `type ${channel.type} is not text`);
      else pass(`#${label}`, channel.name);
    }
  } catch (err) {
    fail('channels', err instanceof Error ? err.message : String(err));
  }

  console.log('opencode');
  const opencode = new OpencodeClient(
    config.opencode.url,
    config.opencode.user,
    config.opencode.password,
  );
  try {
    const sessions = await opencode.listSessions(config.liveRoot, 1);
    pass('api', `${sessions.length} session(s) visible in live root`);
  } catch (err) {
    fail('api', err instanceof Error ? err.message : String(err));
  }

  console.log('dashboard');
  try {
    const res = await fetch(`${config.dashboardUrl}/api/dashboard/state`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) fail('state api', `HTTP ${res.status}`);
    else {
      const body = (await res.json()) as { envs?: unknown[] };
      pass('state api', `${body.envs?.length ?? 0} envs`);
    }
  } catch (err) {
    fail('state api', err instanceof Error ? err.message : String(err));
  }

  console.log('paths');
  for (const [name, path] of [
    ['manager tool', config.managerTool],
    ['manager prompt', config.managerPrompt],
    ['browser cli', config.browserCli],
    ['shots dir', config.shotsDir],
  ] as const) {
    if (existsSync(path)) pass(name, path);
    else fail(name, `missing ${path}`);
  }

  console.log(`\n${ok ? 'PASS' : 'FAIL'}${config.dryRun ? ' (DISCORD_DRY_RUN=1)' : ''}`);
  return ok;
}

function extractManagerPrompt(path: string): string {
  const raw = readFileSync(path, 'utf8');
  const fenced = raw.match(/```markdown\s*\n([\s\S]*?)```/);
  return (fenced?.[1] ?? raw).trim();
}

async function ensureManagerSession(
  config: Config,
  opencode: OpencodeClient,
  state: StateStore,
  log: Logger,
): Promise<string | undefined> {
  const stored = state.managerSessionId;
  if (stored) {
    try {
      await opencode.messages(stored, 1);
      log.info('manager', `reusing session ${stored}`);
      return stored;
    } catch (err) {
      log.warn(
        'manager',
        `stored manager session ${stored} is gone (${err instanceof Error ? err.message : err})`,
      );
      state.managerSessionId = undefined;
    }
  }

  if (config.dryRun) {
    log.info('manager', '[dry-run] no manager session; would create one');
    return undefined;
  }

  try {
    const session = await opencode.createSession({
      title: 'Discord Manager',
      directory: config.manager.directory,
      model: { providerID: 'opencode-go', id: 'deepseek-v4.1-flash', variant: 'high' },
    });
    log.info('manager', `created session ${session.id}`);
    state.managerSessionId = session.id;
    const prompt = extractManagerPrompt(config.managerPrompt);
    if (prompt) {
      await opencode.prompt(session.id, prompt);
      log.info('manager', `loaded manager prompt (${prompt.length} chars)`);
    }
    return session.id;
  } catch (err) {
    log.error(
      'manager',
      `could not create manager session: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

/** Poll a forked session until it produces an assistant message with text. */
async function waitForAnswer(
  opencode: OpencodeClient,
  sessionId: string,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await opencode.messages(sessionId, 5).catch(() => []);
    for (const message of messages) {
      const text = (message.content ?? [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('')
        .trim();
      if (text) return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }
  const checkOnly = argv.includes('--check');
  const forceDryRun = argv.includes('--dry-run');

  loadDotenv();
  const { config, errors } = readConfig();
  if (forceDryRun) config.dryRun = true;
  const log = new Logger(config.logLevel);

  if (errors.length > 0) {
    console.error('Configuration problems:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  if (checkOnly) {
    const ok = await check(config, log);
    process.exit(ok ? 0 : 1);
  }

  const opencode = new OpencodeClient(
    config.opencode.url,
    config.opencode.user,
    config.opencode.password,
  );
  const qa = new QaManager(config.managerTool, config.liveRoot);
  const state = new StateStore(config.statePath);
  const managerClient = createClient('manager', log);
  const envClients = new Map<number, Client>();
  for (const slot of config.slots) envClients.set(slot.n, createClient(slot.label, log));
  const overseerClient = config.overseer ? createClient('overseer', log) : null;

  const clients: Array<[string, Client, string]> = [
    ['manager', managerClient, config.manager.token],
  ];
  for (const slot of config.slots) {
    clients.push([slot.label, envClients.get(slot.n)!, slot.token]);
  }
  if (overseerClient && config.overseer) {
    clients.push(['overseer', overseerClient, config.overseer.token]);
  }

  log.info('main', `starting ${clients.length} clients (dry-run=${config.dryRun})`);
  const results = await Promise.allSettled(
    clients.map(([label, client, token]) => login(client, token, label, log)),
  );
  const online = results.filter((r) => r.status === 'fulfilled').length;
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      log.error(
        clients[i][0],
        `login failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
    }
  }
  console.log(`${online}/${clients.length} bots online`);
  if (online === 0) process.exit(1);

  // `/status` is a guild command (instant) on every bot: it steers the session
  // bound to that channel, so the reply arrives through the normal relay.
  if (!config.dryRun) {
    for (const [label, client] of clients) {
      void (async () => {
        try {
          const guild = await client.guilds.fetch(config.guildId);
          const existing = await guild.commands.fetch();
          if (existing.some((c) => c.name === 'status')) return;
          await guild.commands.create({
            name: 'status',
            description: 'Ask the agent for a short status (what now, what is blocked, next step)',
          });
          log.info(label, 'registered /status');
        } catch (err) {
          log.warn(
            label,
            `could not register /status: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    }
  }

  const status = new StatusPublisher(config, log, state, managerClient, envClients);
  const bridges = new Map<string, Bridge>();

  const managerBridge = new Bridge(config, log, state, opencode, managerClient, {
    label: 'manager',
    channelId: config.manager.channelId,
    directory: config.manager.directory,
    manager: true,
  });
  bridges.set('manager', managerBridge);

  if (overseerClient && config.overseer) {
    const overseerBridge = new Bridge(config, log, state, opencode, overseerClient, {
      label: 'overseer',
      channelId: config.overseer.channelId,
      directory: config.overseer.directory,
      manager: false,
      overseer: true,
      sessionFile: config.overseer.sessionFile,
    });
    bridges.set('overseer', overseerBridge);
  }

  for (const slot of config.slots) {
    const client = envClients.get(slot.n)!;
    bridges.set(
      slot.label,
      new Bridge(config, log, state, opencode, client, {
        label: slot.label,
        channelId: slot.channelId,
        directory: slot.directory,
        manager: false,
      }),
    );
  }

  status.setEventSink((text) => managerBridge.sendToAgent(text, 'event-feed'));

  const managerSession = await ensureManagerSession(config, opencode, state, log);
  if (!managerSession)
    log.warn('manager', 'free text in #manager will not work until a session exists');

  /** The QA-suite manager session, if one was started (operator-gated). */
  const qaSuiteManager = (): string | null => {
    try {
      const raw = readFileSync('/workspaces/studiq/.qa-fix/qa-suite-manager.json', 'utf8');
      return (JSON.parse(raw) as { session?: string }).session ?? null;
    } catch {
      return null;
    }
  };

  const wire = (
    client: Client,
    label: string,
    channelId: string,
    bridge: Bridge,
    isDashboard: boolean,
    defaultEnv?: number,
  ): void => {
    // `/status` is a /btw-style side question: fork the session, ask in the fork,
    // throw the fork away. The agent's own turn is never steered or queued.
    client.on(Events.InteractionCreate, (interaction) => {
      void (async () => {
        if (!interaction.isChatInputCommand() || interaction.commandName !== 'status') return;
        if (interaction.channelId !== channelId) return;
        await interaction.deferReply({ ephemeral: true });
        const sessionId = bridge.session;
        if (!sessionId) {
          await interaction.editReply('No session is attached to this channel yet.');
          return;
        }
        let forkId: string | null = null;
        try {
          forkId = await opencode.fork(sessionId);
          await opencode.prompt(
            forkId,
            'Side question from the operator (/status). Answer only from the conversation above — ' +
              'do not use tools, do not change anything. One short message: what you are doing right ' +
              'now, what is blocked, and the next action. No preamble.',
          );
          const answer = await waitForAnswer(opencode, forkId, 60_000);
          await interaction.editReply(
            (answer ?? 'No answer within 60 s (the fork may still be starting).').slice(0, 1_900),
          );
        } finally {
          if (forkId) await opencode.remove(forkId).catch(() => undefined);
        }
      })().catch((err) =>
        log.error(label, `status command: ${err instanceof Error ? err.message : String(err)}`),
      );
    });

    client.on(Events.MessageCreate, (message: Message) => {
      void (async () => {
        if (!message.inGuild() || message.guildId !== config.guildId) return;
        if (message.author.bot) return;
        if (message.channelId !== channelId) return;
        if (isDashboard) return;
        if (!isOwnerMessage(message.author.id, message.author.bot, [config.ownerId])) {
          log.debug(label, `ignored message from non-owner ${message.author.id}`);
          return;
        }
        const text = message.content.trim();
        const attachments = [...message.attachments.values()];
        if (!text && attachments.length === 0) return;

        const reply = async (content: string, files?: AttachmentBuilder[]): Promise<void> => {
          const channel = message.channel;
          if (!channel.isTextBased()) return;
          await (channel as TextChannel).send({
            content: content.slice(0, 2_000),
            files,
            allowedMentions: { parse: [] },
          });
        };

        // `!qa <text>` routes to the QA-suite manager: the #manager channel is
        // bound to the fix manager, which owns a different loop.
        if (/^!qa\b/i.test(text)) {
          const sid = qaSuiteManager();
          if (!sid) {
            await reply('No QA-suite manager is running — start it with `qa-manager.py manager`.');
            return;
          }
          const body = text.replace(/^!qa\s*/i, '');
          if (body) await opencode.prompt(sid, body);
          await reply(`→ QA-suite manager (${sid.slice(0, 11)}…)`);
          return;
        }

        if (text.startsWith('!')) {
          await handleCommand(text, { config, log, qa, status, defaultEnv }, reply);
        } else {
          await bridge.sendToAgent(text, message.author.username, attachments);
        }
      })().catch((err) =>
        log.error(label, `message handler: ${err instanceof Error ? err.message : String(err)}`),
      );
    });
  };

  wire(managerClient, 'manager', config.manager.channelId, managerBridge, false);
  if (overseerClient && config.overseer) {
    wire(overseerClient, 'overseer', config.overseer.channelId, bridges.get('overseer')!, false);
  }
  for (const slot of config.slots) {
    wire(
      envClients.get(slot.n)!,
      slot.label,
      slot.channelId,
      bridges.get(slot.label)!,
      false,
      slot.n,
    );
  }

  status.start();
  await Promise.all([...bridges.values()].map((bridge) => bridge.start()));

  if (!config.dryRun) {
    for (const [label, channelId] of [
      ['manager', config.manager.channelId],
      ...(config.overseer ? [['overseer', config.overseer.channelId] as [string, string]] : []),
      ...config.slots.map((s) => [s.label, s.channelId] as [string, string]),
    ] as Array<[string, string]>) {
      try {
        const client =
          label === 'manager'
            ? managerClient
            : label === 'overseer'
              ? overseerClient!
              : envClients.get(Number(label.slice(4)))!;
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased()) continue;
        const text = `ready · ${label}`;
        const recent = await (channel as TextChannel).messages.fetch({ limit: 1 });
        const last = recent.first();
        if (last && last.author.id === client.user?.id && last.content === text) continue;
        await (channel as TextChannel).send({ content: text, allowedMentions: { parse: [] } });
      } catch (err) {
        log.warn(
          label,
          `ready message failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('main', `${signal} — shutting down`);
    status.stop();
    for (const bridge of bridges.values()) bridge.stop();
    await Promise.allSettled(clients.map(([, client]) => client.destroy()));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    log.error(
      'main',
      `unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  });
  process.on('uncaughtException', (err) => {
    log.error('main', `uncaught exception: ${err.message}`);
  });

  log.info('main', 'running');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
