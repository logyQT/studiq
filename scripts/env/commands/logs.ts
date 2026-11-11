import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

function tail(path: string, follow: boolean): void {
  if (!existsSync(path)) {
    writeStderrLine(`env:logs: no log at ${path}`);
    return;
  }
  const args = follow ? ['-n', '50', '-f', path] : ['-n', '100', path];
  // Human log lines are diagnostics: route both child streams to our stderr so
  // `--json` stdout stays exactly one JSON object.
  spawnSync('tail', args, { stdio: ['inherit', 2, 2] });
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
  tail(webLogPath(), options.follow);
  return 0;
}
