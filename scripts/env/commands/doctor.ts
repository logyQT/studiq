import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ParsedCommand } from '../atoms';
import { readContract } from '../lib/contract';
import { contractWithLease } from '../lib/contract-lease';
import { probeHttp } from '../lib/health';
import { probePortBind } from '../lib/net';
import { printJson, writeLine } from '../lib/output';
import { readRegistry, registryPathExists } from '../lib/registry';
import { REPO_ROOT, canon, currentBranchName, primaryCheckoutPath } from '../lib/repo';
import { probeStackStatus, readListedStackRuntime, type StackStatus } from '../lib/stack';
import { normalizeLocalhost, stripDbCredentials, trimTrailingSlash } from '../lib/urls';
import { readWebPid } from '../lib/web';

export interface ObservabilityStatus {
  up: boolean;
  project: string;
  primary: string;
  /** The primary checkout's compose file already carries the fixed project name. */
  primaryReady: boolean;
  start: string;
  grafana: number;
  tempo: number;
  loki: number;
  prometheus: number;
  otlp: number;
}

export interface DoctorReport {
  ok: boolean;
  problems: string[];
  warnings: string[];
  observability: ObservabilityStatus;
  lines: string[];
}

const OBSERVABILITY_PROJECT = 'studiq-observability';
const OBSERVABILITY_PROBE_MS = 750;

function orDash(value: string | number | null): string {
  return value === null || value === '' ? '-' : String(value);
}

function httpLabel(value: number): string {
  return value > 0 ? String(value) : '-';
}

function isWebHealthy(code: number): boolean {
  return code >= 200 && code < 400;
}

function stackLines(stack: StackStatus | null): string[] {
  if (!stack)
    return ['  none for this branch — `bun run env:ensure --profile web` creates or resumes one'];
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
  const contract = contractWithLease(readContract());
  const registry = readRegistry();
  // A missing registry is normal on a fresh machine; only an existing but
  // untrusted directory is worth a warning.
  const registryExists = registryPathExists(registry.dir);
  const trusted = registry.trusted;
  const statusProbe = contract.shared
    ? { stack: null as StackStatus | null, error: null as string | null }
    : probeStackStatus(contract.stackName);
  const stack = statusProbe.stack;
  // A running stack already reports its runtime; only a stopped/missing one
  // needs the `stack list` lookup (one status call on the running path).
  const listedRuntime =
    !contract.shared && !stack?.runtime ? readListedStackRuntime(contract.stackName) : null;
  // Read-only commands never choose or predict a runtime (phase 2 `ensure` owns
  // selection and exit 3). They report what the stack itself reports.
  const observedRuntime = stack?.runtime || listedRuntime || null;
  const runtimeSource = stack
    ? 'running stack'
    : listedRuntime
      ? 'persisted stack'
      : contract.shared
        ? 'shared stack (owned by another checkout; not inspected)'
        : 'none (no stack for this branch)';

  const webPid = readWebPid();
  const webHttp = await probeHttp(contract.appUrl);
  // Same probe `env:ports` uses: a bind failure includes a listener on any
  // other interface, which a loopback connect probe would miss. Only
  // EADDRINUSE is a conflict; other bind errors are reported as warnings.
  const appPortProbe = await probePortBind(contract.appPort);
  const appPortBusy = appPortProbe.state === 'in-use';

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

  // Observability is machine-wide and owned by the primary checkout. Probe it
  // read-only so an agent in a worktree gets the start command that cannot
  // create a second stack.
  const primary = primaryCheckoutPath();
  const [grafana, tempo, loki, prometheus, otlp] = await Promise.all([
    probeHttp('http://localhost:3001/api/health', OBSERVABILITY_PROBE_MS),
    probeHttp('http://localhost:3200/ready', OBSERVABILITY_PROBE_MS),
    probeHttp('http://localhost:3100/ready', OBSERVABILITY_PROBE_MS),
    probeHttp('http://localhost:9090/-/ready', OBSERVABILITY_PROBE_MS),
    probeHttp('http://localhost:4318/', OBSERVABILITY_PROBE_MS),
  ]);
  const primaryCompose = join(primary, 'docker-compose.yml');
  const primaryReady =
    existsSync(primaryCompose) &&
    readFileSync(primaryCompose, 'utf8').includes(`name: ${OBSERVABILITY_PROJECT}`);
  const upCount = [grafana, tempo, loki, prometheus, otlp].filter((code) => code > 0).length;
  const observability: ObservabilityStatus = {
    up: upCount === 5,
    project: OBSERVABILITY_PROJECT,
    primary,
    primaryReady,
    start: `cd "${primary}" && docker compose up -d`,
    grafana,
    tempo,
    loki,
    prometheus,
    otlp,
  };

  const problems: string[] = [];
  const warnings: string[] = [];

  // A stopped stack answers cleanly (exit 0, no API URL), so an error here means
  // the CLI itself could not be spawned or timed out — never "no stack".
  if (statusProbe.error) {
    warnings.push(`cannot read 'supabase stack status': ${statusProbe.error}`);
  }

  // Shared mode never starts a stack in this checkout, so a missing engine is
  // not a conflict; runtime availability is phase 2's job, not doctor's.
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
  if (observedRuntime === 'docker') {
    warnings.push(
      'stack runtime=docker (compatibility mode); run `env:down --all` then `env:ensure` to recreate it',
    );
  }
  if (!trusted && registryExists) {
    warnings.push(
      `registry directory ${registry.dir} is not a trusted private directory; entries are ignored`,
    );
  }
  if (contract.shared && !sharedSupabaseUrl) {
    warnings.push(
      'SUPABASE_SHARED=1 but SUPABASE_URL is not exported to this unwrapped command (run `bun run env:check:quiet` for env checks; exit code only)',
    );
  }
  if (appPortProbe.state === 'unavailable') {
    warnings.push(
      `cannot check app port ${contract.appPort}: ${appPortProbe.error ?? 'bind failed'} ` +
        '(not a listener conflict)',
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
    `  registry   ${registry.dir}${trusted || !registryExists ? '' : ' (untrusted — entries ignored)'}`,
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
    `  observed   ${observedRuntime ?? 'unknown (not observable here)'}`,
    `  source     ${runtimeSource}`,
    '  selection  read-only commands never choose a runtime (env:ensure, phase 2)',
  );

  const observabilityStatus = observability.up
    ? 'up'
    : upCount > 0
      ? `partial (${upCount}/5)`
      : 'down';

  lines.push(
    '',
    '▸ Observability (machine-wide)',
    `  status     ${observabilityStatus}`,
    `  project    ${observability.project}`,
    `  primary    ${observability.primary}${observability.primaryReady ? '' : ' (compose file predates the fixed project name; update it first)'}`,
    `  grafana    http=${httpLabel(observability.grafana)}`,
    `  tempo      http=${httpLabel(observability.tempo)}`,
    `  loki       http=${httpLabel(observability.loki)}`,
    `  prometheus http=${httpLabel(observability.prometheus)}`,
    `  otlp       http=${httpLabel(observability.otlp)}`,
    `  start      ${observability.start}`,
  );
  if (!observability.up) {
    lines.push('  note       start it once from the primary checkout, never from a worktree');
    if (!observability.primaryReady) {
      lines.push(`  note       update the primary first: git -C "${observability.primary}" pull`);
    }
    if (upCount > 0) {
      lines.push(
        '  note       a partial/legacy stack is holding a port; identify it with `docker compose ls` and stop that project from its own directory',
      );
    }
  }

  lines.push('', '▸ Ports');
  if (appPortProbe.state === 'unavailable') {
    lines.push(
      `  app        ${contract.appPort}  check failed (${appPortProbe.error ?? 'bind failed'})`,
    );
  } else if (appPortBusy && webPid && isWebHealthy(webHttp)) {
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
    lines.push('  Start/repair:         bun run env:ensure --profile web');
  } else {
    lines.push('', '✔ No ownership or port conflicts for this checkout.');
  }

  return { ok: problems.length === 0, problems, warnings, observability, lines };
}

export async function runDoctor(parsed: ParsedCommand): Promise<number> {
  const report = await buildReport();
  if (parsed.json) {
    printJson({
      ok: report.ok,
      problems: report.problems,
      warnings: report.warnings,
      observability: report.observability,
    });
  } else {
    for (const line of report.lines) writeLine(line);
  }
  return report.ok ? 0 : 1;
}
