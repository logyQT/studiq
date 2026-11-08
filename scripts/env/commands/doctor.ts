import type { ParsedCommand } from '../atoms';
import { readContract } from '../lib/contract';
import { probeHttp } from '../lib/health';
import { portInUse } from '../lib/net';
import { printJson, writeLine } from '../lib/output';
import { readRegistry, registryDirTrusted } from '../lib/registry';
import { REPO_ROOT, canon, currentBranchName } from '../lib/repo';
import { nativeRuntimeSupported, resolveRuntime, runtimeAvailable } from '../lib/runtime';
import { readListedStackRuntime, readStackStatus, type StackStatus } from '../lib/stack';
import { normalizeLocalhost, stripDbCredentials, trimTrailingSlash } from '../lib/urls';
import { readWebPid } from '../lib/web';

export interface DoctorReport {
  ok: boolean;
  problems: string[];
  warnings: string[];
  lines: string[];
}

function orDash(value: string | number | null): string {
  return value === null || value === '' ? '-' : String(value);
}

function isWebHealthy(code: number): boolean {
  return code >= 200 && code < 400;
}

function stackLines(stack: StackStatus | null): string[] {
  if (!stack) return ['  none for this branch — `bun dev:up` creates or resumes one'];
  const lines = [
    `  id         ${stack.id}`,
    `  name       ${stack.name}`,
    `  branch     ${stack.branch ?? 'unknown'}`,
    `  runtime    ${stack.runtime || 'unknown'}`,
    `  lifecycle  ${stack.lifecycle ?? 'unknown'}`,
    `  supabase   ${stack.apiUrl}`,
    `  db         ${orDash(stack.dbUrl)}`,
    `  studio     ${orDash(stack.studioUrl)}`,
    `  mail       ${orDash(stack.mailUrl)}`,
    `  drift      ${stack.configDrift ?? 'unknown'}`,
  ];
  return lines;
}

async function buildReport(): Promise<DoctorReport> {
  const contract = readContract();
  const registry = readRegistry();
  const trusted = registryDirTrusted(registry.dir);
  const stack = contract.shared ? null : readStackStatus(contract.stackName);
  const listedRuntime = contract.shared ? null : readListedStackRuntime(contract.stackName);
  const runtime = resolveRuntime(stack, listedRuntime);
  const runtimeOk = runtimeAvailable(runtime.effective);
  const nativeOk = nativeRuntimeSupported();

  const webPid = readWebPid();
  const webHttp = await probeHttp(contract.appUrl);
  const appPortBusy = await portInUse(contract.appPort);

  const sharedSupabaseUrl = contract.shared
    ? process.env.SUPABASE_URL
      ? normalizeLocalhost(trimTrailingSlash(process.env.SUPABASE_URL))
      : null
    : null;
  const supabaseUrl = stack?.apiUrl ?? sharedSupabaseUrl;
  const supabaseHttp = supabaseUrl ? await probeHttp(`${supabaseUrl}/auth/v1/health`) : 0;
  const sharedDbUrl = contract.shared
    ? stripDbCredentials(process.env.SUPABASE_DB_URL ?? '')
    : null;

  const problems: string[] = [];
  const warnings: string[] = [];

  // Shared mode never starts a stack in this checkout, so a missing engine is
  // informational there, not a conflict.
  if (!runtimeOk && !contract.shared) {
    problems.push(`runtime '${runtime.effective}' is unavailable on this machine`);
  }
  if (stack && !contract.shared) {
    if (stack.projectRoot && canon(stack.projectRoot) !== REPO_ROOT) {
      problems.push(`stack identity belongs to another checkout (${stack.projectRoot})`);
    }
    if (supabaseHttp !== 200) {
      problems.push(`Supabase stack is running but ${stack.apiUrl}/auth/v1/health is not healthy`);
    }
    if (stack.configDrift && stack.configDrift !== 'unchanged') {
      warnings.push('stack config drift: restart the stack to apply config.toml changes');
    }
  }
  if (runtime.effective === 'docker') {
    warnings.push(
      'this stack uses runtime=docker (explicit); recreate with --runtime native to convert',
    );
  }
  if (!trusted) {
    warnings.push(
      `registry directory ${registry.dir} is not a trusted private directory; entries are ignored`,
    );
  }
  if (contract.shared && !sharedSupabaseUrl) {
    warnings.push(
      'SUPABASE_SHARED=1 but SUPABASE_URL is not exported to this unwrapped command (run `bun run env:verify` for env checks)',
    );
  }

  // Only a port that nothing in this contract can explain is a conflict. A pid
  // in `.dev/web.pid` alone is not proof the server serves APP_URL (the operator
  // may have changed the port), so the health probe decides.
  if (appPortBusy && !(webPid && isWebHealthy(webHttp))) {
    problems.push(`app port ${contract.appPort} is in use by another process`);
  }

  const lines: string[] = [
    '▸ Checkout',
    `  worktree   ${REPO_ROOT}`,
    `  branch     ${currentBranchName()}`,
    `  registry   ${registry.dir}${trusted ? '' : ' (untrusted — entries ignored)'}`,
  ];

  lines.push('', '▸ Local stack');
  if (contract.shared) {
    lines.push('  shared mode — this checkout does not own the stack (no start/stop/destroy)');
    lines.push(`  supabase   ${orDash(supabaseUrl)}  http=${supabaseHttp}`);
    lines.push(`  db         ${orDash(sharedDbUrl)}`);
  } else {
    lines.push(...stackLines(stack));
  }

  lines.push(
    '',
    '▸ App',
    `  port       ${contract.appPort} → ${contract.appUrl}`,
    `  web        http=${webHttp} pid=${orDash(webPid)}`,
  );

  lines.push(
    '',
    '▸ Runtime',
    `  configured ${runtime.configured || 'blank (docker)'}`,
    `  persisted  ${runtime.persisted ?? 'none'}`,
    `  effective  ${runtime.effective}`,
    `  ${runtime.effective.padEnd(9)}  ${
      contract.shared
        ? 'not used (shared mode never starts a stack here)'
        : runtimeOk
          ? 'ok'
          : 'unavailable (the stack cannot start)'
    }`,
  );
  if (runtime.effective !== 'native') {
    lines.push(
      `  native     ${nativeOk ? 'supported on this platform' : 'unsupported on this platform'}`,
    );
  }

  lines.push('', '▸ Ports');
  if (appPortBusy && webPid && isWebHealthy(webHttp)) {
    lines.push(`  app        ${contract.appPort}  in use (this checkout)`);
  } else if (appPortBusy) {
    lines.push(`  app        ${contract.appPort}  in use (another process)`);
  } else {
    lines.push(`  app        ${contract.appPort}  free`);
  }
  if (contract.shared) {
    lines.push('  stack      dynamic (owned by the shared checkout)');
  } else if (stack) {
    lines.push(`  api        ${stack.ports.api}  in use (this stack)`);
    if (stack.ports.db) lines.push(`  db         ${stack.ports.db}  in use (this stack)`);
    if (stack.ports.studio) lines.push(`  studio     ${stack.ports.studio}  in use (this stack)`);
    if (stack.ports.mail) lines.push(`  mail       ${stack.ports.mail}  in use (this stack)`);
    if (stack.ports.mailSmtp)
      lines.push(`  mail-smtp  ${stack.ports.mailSmtp}  in use (this stack)`);
    if (stack.ports.mailPop3)
      lines.push(`  mail-pop3  ${stack.ports.mailPop3}  in use (this stack)`);
    if (stack.ports.pgmeta) lines.push(`  pgmeta     ${stack.ports.pgmeta}  in use (this stack)`);
    if (stack.ports.analytics) {
      lines.push(`  analytics  ${stack.ports.analytics}  in use (this stack)`);
    }
    if (stack.ports.edgeInspector) {
      lines.push(`  edge       ${stack.ports.edgeInspector}  in use (this stack)`);
    }
    if (stack.ports.pooler) lines.push(`  pooler     ${stack.ports.pooler}  in use (this stack)`);
  } else {
    lines.push('  stack      no stack ports (stack stopped)');
  }

  lines.push('', '▸ Registry');
  if (registry.entries.length === 0) {
    lines.push('  (no entries)');
  } else {
    for (const entry of registry.entries) {
      lines.push(`  ${entry.projectId.padEnd(48)} ${entry.worktree || '(unknown worktree)'}`);
    }
  }

  if (warnings.length > 0) {
    lines.push('', '▸ Warnings');
    for (const warning of warnings) lines.push(`  ⚠ ${warning}`);
  }

  if (problems.length > 0) {
    lines.push('', '▸ Next steps');
    for (const problem of problems) lines.push(`  ✘ ${problem}`);
    lines.push('  Pick a free APP_PORT: bun run env:ports');
    lines.push('  Start/repair:         bun dev:up');
  } else {
    lines.push('', '✔ No ownership or port conflicts for this checkout.');
  }

  return { ok: problems.length === 0, problems, warnings, lines };
}

export async function runDoctor(parsed: ParsedCommand): Promise<number> {
  const report = await buildReport();
  if (parsed.json) {
    printJson({ ok: report.ok, problems: report.problems, warnings: report.warnings });
  } else {
    for (const line of report.lines) writeLine(line);
  }
  return report.ok ? 0 : 1;
}
