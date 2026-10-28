import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { AttachmentBuilder } from 'discord.js';
import type { Config } from './config';
import type { Logger } from './log';
import type { QaManager, RunResult } from './qa';
import type { StatusPublisher } from './status';

export interface CommandContext {
  config: Config;
  log: Logger;
  qa: QaManager;
  status: StatusPublisher;
  defaultEnv?: number;
}

export interface CommandReply {
  (content: string, files?: AttachmentBuilder[]): Promise<void>;
}

const HELP = `**QA manager commands**
\`!status\` — slots, state, scenario, pending
\`!free\` — free slots
\`!run <ID> [--env N]\` — dispatch a manual scenario
\`!suite <CASEID> [--env N]\` — start a QA-suite worker for one case
\`!queue <ID…>\` — fill free slots
\`!report [env]\` — last agent report
\`!decisions\` — pending decisions
\`!show <dec>\` — decision detail
\`!file <dec>\` — file it (owner)
\`!skip <dec>\` — answer skip
\`!spawn <dec>\` — spawn an investigator
\`!screenshot [env]\` — capture the slot browser
\`!help\` — this list

Free text goes to the ${'manager'} agent.`;

function block(text: string, max = 1_900): string {
  const clean = text.trim() || '(no output)';
  const clipped = clean.length > max ? `${clean.slice(0, max)}\n… (truncated)` : clean;
  return `\`\`\`\n${clipped.replace(/```/g, 'ˋˋˋ')}\n\`\`\``;
}

function firstLine(result: RunResult): string {
  const text = (result.stdout || result.stderr).trim();
  return text.split('\n')[0] ?? '';
}

function envArg(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = raw.match(/^(?:env-)?([1-8])$/i);
  return match ? Number(match[1]) : undefined;
}

export async function handleCommand(
  raw: string,
  ctx: CommandContext,
  reply: CommandReply,
): Promise<boolean> {
  if (!raw.startsWith('!')) return false;

  const [head, ...rest] = raw.slice(1).trim().split(/\s+/);
  const cmd = (head ?? '').toLowerCase();
  const args = rest.filter(Boolean);

  try {
    switch (cmd) {
      case 'help':
        await reply(HELP);
        return true;

      case 'status': {
        const snap = ctx.status.current();
        if (!snap.ok || snap.envs.length === 0) {
          const res = await ctx.qa.status();
          await reply(block(res.stdout || res.stderr));
          return true;
        }
        const rows = snap.envs.map((env) => {
          const scenario = env.scenario || '—';
          return `${env.label.padEnd(7)} ${env.state.padEnd(8)} ${scenario.padEnd(34)} ${env.pending}p  ${env.sessionId || 'no session'}`;
        });
        const header = `${'slot'.padEnd(7)} ${'state'.padEnd(8)} ${'scenario'.padEnd(34)} pend session`;
        const counts = snap.envs.reduce(
          (acc, env) => {
            acc[env.state] += 1;
            return acc;
          },
          { free: 0, busy: 0, waiting: 0 },
        );
        await reply(
          `${block([header, ...rows].join('\n'))}\n${counts.busy} busy · ${counts.waiting} waiting · ${counts.free} free`,
        );
        return true;
      }

      case 'free': {
        const res = await ctx.qa.free();
        await reply(block(res.stdout || res.stderr));
        return true;
      }

      case 'run': {
        const scenario = args.find((a) => !a.startsWith('-') && !/^[1-8]$/.test(a));
        const envFlag = args.findIndex((a) => a === '--env' || a === '-e');
        const env = envArg(envFlag >= 0 ? args[envFlag + 1] : undefined);
        if (!scenario) {
          await reply('Usage: `!run <scenario-id> [--env N]`');
          return true;
        }
        const res = await ctx.qa.dispatch(scenario, env);
        await reply(block(res.stdout || res.stderr));
        await ctx.status.refresh();
        return true;
      }

      case 'suite': {
        const caseId = args.find((a) => !a.startsWith('-') && !/^[1-8]$/.test(a));
        const envFlag = args.findIndex((a) => a === '--env' || a === '-e');
        const env = envArg(envFlag >= 0 ? args[envFlag + 1] : undefined);
        if (!caseId) {
          await reply('Usage: `!suite <CASEID> [--env N]`');
          return true;
        }
        const res = await ctx.qa.suite(caseId, env);
        await reply(block(res.stdout || res.stderr));
        await ctx.status.refresh();
        return true;
      }

      case 'queue': {
        const ids = args.flatMap((a) => a.split(',')).filter(Boolean);
        if (ids.length === 0) {
          await reply('Usage: `!queue <scenario-id…>`');
          return true;
        }
        const res = await ctx.qa.queue(ids);
        await reply(block(res.stdout || res.stderr));
        await ctx.status.refresh();
        return true;
      }

      case 'report': {
        const env = envArg(args[0]) ?? ctx.defaultEnv;
        const res = await ctx.qa.report(env);
        await reply(block(res.stdout || res.stderr, 1_800));
        return true;
      }

      case 'decisions': {
        const res = await ctx.qa.decisionsPending();
        await reply(block(res.stdout || res.stderr));
        return true;
      }

      case 'show': {
        const id = args[0];
        if (!id) {
          await reply('Usage: `!show <dec_id>`');
          return true;
        }
        const res = await ctx.qa.decisionsShow(id);
        await reply(block(res.stdout || res.stderr));
        return true;
      }

      case 'file': {
        const id = args[0];
        if (!id) {
          await reply('Usage: `!file <dec_id>`');
          return true;
        }
        const res = await ctx.qa.decisionsFile(id);
        await reply(
          `File \`${id}\` → ${firstLine(res)}\n${block(res.stdout || res.stderr, 1_200)}`,
        );
        return true;
      }

      case 'skip': {
        const id = args[0];
        if (!id) {
          await reply('Usage: `!skip <dec_id>`');
          return true;
        }
        const res = await ctx.qa.decisionsAnswer(id, 'skip');
        await reply(block(res.stdout || res.stderr));
        return true;
      }

      case 'spawn': {
        const id = args[0];
        if (!id) {
          await reply('Usage: `!spawn <dec_id>`');
          return true;
        }
        const res = await ctx.qa.decisionsSpawn(id);
        await reply(block(res.stdout || res.stderr));
        await ctx.status.refresh();
        return true;
      }

      case 'screenshot': {
        await screenshot(ctx, envArg(args[0]) ?? ctx.defaultEnv ?? 1, reply);
        return true;
      }

      default:
        await reply(`Unknown command \`!${cmd}\`. Try \`!help\`.`);
        return true;
    }
  } catch (err) {
    ctx.log.error('commands', err instanceof Error ? err.message : String(err));
    await reply(
      `Command failed: ${err instanceof Error ? err.message.slice(0, 400) : 'unknown error'}`,
    );
    return true;
  }
}

function shotPath(stdout: string): string | null {
  const text = stdout.trim();
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['path', 'file', 'screenshot', 'output']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.endsWith('.png')) return value;
    }
  } catch {
    // not JSON; fall through to a path scan
  }
  const match = stdout.match(/(\/[^\s"'`()\[\]]+\.png)/);
  return match?.[1] ?? null;
}

async function screenshot(ctx: CommandContext, env: number, reply: CommandReply): Promise<void> {
  const config = ctx.config;
  const slot = config.slots.find((s) => s.n === env);
  if (!slot) {
    await reply(`No such env: ${env}`);
    return;
  }

  const name = `discord-${Date.now()}`;
  const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolvePromise) => {
      execFile(
        'bun',
        [config.browserCli, 'screenshot', '--name', name],
        { cwd: slot.directory, timeout: 90_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
        (error, stdout, stderr) => {
          resolvePromise({ code: error ? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
        },
      );
    },
  );

  if (result.code !== 0) {
    ctx.log.warn(
      'screenshot',
      `browser-cli failed for ${slot.label}: ${result.stderr.slice(0, 300)}`,
    );
    await reply(
      `Screenshot failed in ${slot.label}:\n${block(result.stderr || result.stdout, 800)}`,
    );
    return;
  }

  const path = shotPath(result.stdout);
  if (!path) {
    await reply(
      `Could not parse a screenshot path from browser-cli:\n${block(result.stdout, 700)}`,
    );
    return;
  }
  const absolute = resolve(path);
  if (!absolute.startsWith(`${resolve(config.shotsDir)}/`) || !existsSync(absolute)) {
    await reply(`Screenshot path is outside SHOTS_DIR or missing: \`${absolute}\``);
    return;
  }

  await reply(`screenshot · ${slot.label} · ${basename(absolute)}`, [
    new AttachmentBuilder(absolute, { name: basename(absolute) }),
  ]);
}
