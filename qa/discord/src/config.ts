import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(here, '..');

export interface SlotConfig {
  n: number;
  label: string;
  token: string;
  channelId: string;
  directory: string;
}

export interface Config {
  guildId: string;
  ownerId: string;
  dryRun: boolean;
  statusMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  opencode: { url: string; user: string; password: string };
  dashboardUrl: string;
  liveRoot: string;
  managerTool: string;
  managerPrompt: string;
  browserCli: string;
  shotsDir: string;
  statePath: string;
  dashboardChannelId: string;
  manager: { token: string; channelId: string; directory: string };
  slots: SlotConfig[];
}

/** Minimal dotenv reader. Existing process env wins, so shell overrides still work. */
export function loadDotenv(path = join(packageRoot, '.env')): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const SNOWFLAKE = /^\d{17,20}$/;
const TOKEN = /^[A-Za-z0-9_.-]{50,}$/;

function int(name: string, fallback: number, errors: string[]): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    errors.push(`${name} must be a positive integer (got ${raw})`);
    return fallback;
  }
  return n;
}

export function readConfig(): { config: Config; errors: string[] } {
  const errors: string[] = [];
  const env = process.env;

  const need = (name: string): string => {
    const v = (env[name] ?? '').trim();
    if (!v) errors.push(`${name} is missing`);
    return v;
  };

  const guildId = need('DISCORD_GUILD_ID');
  const ownerId = need('DISCORD_OWNER_ID');
  if (guildId && !SNOWFLAKE.test(guildId)) errors.push('DISCORD_GUILD_ID is not a snowflake');
  if (ownerId && !SNOWFLAKE.test(ownerId)) errors.push('DISCORD_OWNER_ID is not a snowflake');

  const managerToken = need('DISCORD_MANAGER_TOKEN');
  const managerChannelId = need('DISCORD_MANAGER_CHANNEL_ID');
  const dashboardChannelId = need('DISCORD_DASHBOARD_CHANNEL_ID');

  const slots: SlotConfig[] = [];
  for (let n = 1; n <= 8; n++) {
    const token = need(`DISCORD_ENV${n}_TOKEN`);
    const channelId = need(`DISCORD_ENV${n}_CHANNEL_ID`);
    slots.push({ n, label: `env-${n}`, token, channelId, directory: '' });
  }

  for (const [label, value] of [
    ['DISCORD_MANAGER_TOKEN', managerToken],
    ...slots.map((s) => [`DISCORD_ENV${s.n}_TOKEN`, s.token] as const),
  ]) {
    if (value && !TOKEN.test(value)) errors.push(`${label} does not look like a bot token`);
  }
  for (const [label, value] of [
    ['DISCORD_MANAGER_CHANNEL_ID', managerChannelId],
    ['DISCORD_DASHBOARD_CHANNEL_ID', dashboardChannelId],
    ...slots.map((s) => [`DISCORD_ENV${s.n}_CHANNEL_ID`, s.channelId] as const),
  ]) {
    if (value && !SNOWFLAKE.test(value)) errors.push(`${label} is not a snowflake`);
  }

  const channelIds = [
    managerChannelId,
    dashboardChannelId,
    ...slots.map((s) => s.channelId),
  ].filter(Boolean);
  if (new Set(channelIds).size !== channelIds.length) errors.push('channel IDs must be distinct');

  const liveRoot = (env.QA_LIVE_ROOT ?? '/workspaces/studiq/.worktrees/qa-env').trim();
  for (const slot of slots) slot.directory = `${liveRoot.replace(/\/+$/, '')}-${slot.n}`;

  const level = (env.DISCORD_LOG_LEVEL ?? 'info').trim().toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(level)) {
    errors.push(`DISCORD_LOG_LEVEL must be one of debug|info|warn|error (got ${level})`);
  }

  const config: Config = {
    guildId,
    ownerId,
    dryRun: (env.DISCORD_DRY_RUN ?? '1') !== '0',
    statusMs: int('DISCORD_STATUS_MS', 15_000, errors),
    logLevel: (['debug', 'info', 'warn', 'error'].includes(level)
      ? level
      : 'info') as Config['logLevel'],
    opencode: {
      url: (env.OPENCODE_URL ?? 'http://127.0.0.1:4096').replace(/\/+$/, ''),
      user: (env.OPENCODE_USER ?? 'opencode').trim(),
      password: (env.OPENCODE_PASSWORD ?? '').trim(),
    },
    dashboardUrl: (env.DASHBOARD_URL ?? 'http://127.0.0.1:5000').replace(/\/+$/, ''),
    liveRoot,
    managerTool: (env.QA_MANAGER_TOOL ?? '').trim(),
    managerPrompt: (env.QA_MANAGER_PROMPT ?? '').trim(),
    browserCli: (env.BROWSER_CLI ?? '').trim(),
    shotsDir: (env.SHOTS_DIR ?? '').trim(),
    statePath: join(packageRoot, 'state.json'),
    dashboardChannelId,
    manager: { token: managerToken, channelId: managerChannelId, directory: liveRoot },
    slots,
  };

  if (!config.opencode.password) errors.push('OPENCODE_PASSWORD is missing');
  for (const [name, value] of [
    ['QA_MANAGER_TOOL', config.managerTool],
    ['QA_MANAGER_PROMPT', config.managerPrompt],
    ['BROWSER_CLI', config.browserCli],
    ['SHOTS_DIR', config.shotsDir],
  ] as const) {
    if (!value) errors.push(`${name} is missing`);
    else if (!existsSync(value)) errors.push(`${name} does not exist: ${value}`);
  }
  if (config.managerTool && !isAbsolute(config.managerTool)) {
    errors.push(`QA_MANAGER_TOOL must be an absolute path: ${config.managerTool}`);
  }

  return { config, errors };
}
