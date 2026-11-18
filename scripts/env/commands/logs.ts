import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import type { ParsedCommand } from '../atoms';
import { readContractLenient } from '../lib/contract';
import { contractWithLease } from '../lib/contract-lease';
import { probeHttp } from '../lib/health';
import { printJson, redactSecrets, writeStderrLine } from '../lib/output';
import { probeStackStatus } from '../lib/stack';
import { stackLogs } from '../lib/stack-lifecycle';
import { readWebPid, webLogPath } from '../lib/web';

interface LogsHeader {
  project: string;
  web: { url: string; http: number; pid: number | null };
  supabase: { url: string | null; http: number };
  log: string;
}

/** How often `follow` looks for bytes appended since the last read. */
const FOLLOW_POLL_MS = 250;
/** Lines printed before following starts. */
const FOLLOW_LINES = 50;
/** Lines printed by `--no-follow`. */
const SNAPSHOT_LINES = 100;

/** The last `count` lines, without the empty element a trailing newline leaves. */
function lastLines(text: string, count: number): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.slice(-count);
}

function writeLines(lines: string[]): void {
  for (const line of lines) writeStderrLine(line);
}

/** Bytes `[start, start + length)` of `path`; a shorter file yields what it has. */
function readRange(path: string, start: number, length: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Print the last `count` lines, then stream appended bytes until interrupted.
 *
 * In-process instead of `spawnSync('tail', ['-f', …])`: `tail` is coreutils, so
 * the CLI would refuse to follow logs on a host without it, and a spawned child
 * survives the Ctrl-C that ends the CLI.
 */
async function follow(path: string, count: number): Promise<void> {
  const head = readFileSync(path);
  writeLines(lastLines(head.toString('utf8'), count));
  let offset = head.length;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_POLL_MS));
    const size = sizeOf(path);
    // A truncated or replaced log starts over; an append never shrinks the file.
    if (size < offset) offset = 0;
    if (size === offset) continue;
    const chunk = readRange(path, offset, size - offset);
    if (chunk.length === 0) continue;
    // Human log lines are diagnostics: route them to stderr so `--json` stdout
    // stays exactly one JSON object.
    process.stderr.write(chunk);
    offset += chunk.length;
  }
}

async function tail(path: string, followOutput: boolean): Promise<number> {
  if (!existsSync(path)) {
    writeStderrLine(`env:logs: no log at ${path}`);
    return 0;
  }
  if (followOutput) await follow(path, FOLLOW_LINES);
  else writeLines(lastLines(readFileSync(path, 'utf8'), SNAPSHOT_LINES));
  return 0;
}

/**
 * Stack logs + `.dev/web.log`. `--no-follow` prints the last 100 web log lines
 * instead of following; the stack's last 50 lines are always printed first.
 */
export async function runLogs(parsed: ParsedCommand): Promise<number> {
  const options = parsed.logs;
  if (!options) return 2;
  const contract = contractWithLease(readContractLenient());
  const stackName = options.stack ?? contract.stackName;
  const stack = contract.shared ? null : probeStackStatus(stackName).stack;
  const webPid = readWebPid();
  const webUrl = contract.appUrl;
  const webHttp = await probeHttp(webUrl);
  const supabaseUrl = contract.shared
    ? (process.env.SUPABASE_URL ?? null)
    : (stack?.apiUrl ?? null);
  const supabaseHttp = supabaseUrl ? await probeHttp(`${supabaseUrl}/auth/v1/health`) : 0;

  const header: LogsHeader = {
    project: contract.shared
      ? `shared${contract.sharedOwner ? `: ${contract.sharedOwner}` : ''}`
      : stack
        ? `stack ${stack.id.slice(0, 12)}${stack.name !== 'default' ? ` (${stack.name})` : ''}`
        : '(no running stack for this branch)',
    web: { url: webUrl, http: webHttp, pid: webPid },
    supabase: { url: supabaseUrl, http: supabaseHttp },
    log: '.dev/web.log',
  };

  if (parsed.json) {
    printJson(header);
  } else {
    writeStderrLine(`project    ${header.project}`);
    writeStderrLine(`web        ${webUrl}  http=${webHttp}  pid=${webPid ?? '-'}`);
    writeStderrLine(`supabase   ${supabaseUrl ?? '-'}  http=${supabaseHttp}`);
  }

  if (!contract.shared) {
    const logs = stackLogs(stackName, 50);
    if (logs.stdout.trim()) writeStderrLine(`\n──── supabase stack logs (last 50) ────`);
    if (logs.stdout.trim()) writeStderrLine(redactSecrets(logs.stdout.trimEnd()));
    if (logs.stderr.trim()) writeStderrLine(redactSecrets(logs.stderr.trimEnd()));
  }

  writeStderrLine(`\n──── ${webLogPath()} ────`);
  return tail(webLogPath(), options.follow);
}
